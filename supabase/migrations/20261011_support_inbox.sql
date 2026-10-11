begin;

alter table public.user_profiles add column if not exists role text default 'user';

-- Leave existing profile policies intact; browser sessions cannot assign/change roles.
create or replace function public.support_protect_profile_role()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') or coalesce(auth.role(),'') in ('anon','authenticated') then
    if TG_OP = 'INSERT' then
      if coalesce(new.role, 'user') <> 'user' then
        raise exception 'Profile roles are server managed' using errcode = '42501';
      end if;
    elsif new.role is distinct from old.role or new.id is distinct from old.id then
      raise exception 'Profile roles are server managed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists support_protect_profile_role on public.user_profiles;
create trigger support_protect_profile_role before insert or update on public.user_profiles
for each row execute function public.support_protect_profile_role();

create or replace function public.support_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.user_profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.support_is_admin() from public, anon;
grant execute on function public.support_is_admin() to authenticated;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  provider_email_id uuid not null unique,
  sender text not null,
  recipients text[] not null,
  cc text[] not null default '{}',
  subject text not null,
  message_id text,
  received_at timestamptz not null,
  text_body text,
  html_body text,
  attachments jsonb not null default '[]',
  created_at timestamptz not null default now(),
  check (text_body is not null or html_body is not null),
  check (octet_length(coalesce(text_body,'')) + octet_length(coalesce(html_body,'')) <= 2097152)
);
create index if not exists support_messages_created_idx on public.support_messages(created_at desc, id);

-- No FK: retain deduplication tombstones after an admin deletes the message.
-- Notification payload is removed on deletion, but the provider ID remains.
create table if not exists public.support_notification_jobs (
  provider_email_id uuid primary key,
  message_id uuid not null unique,
  payload jsonb,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','needs_review','suppressed')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  outbound_email_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists support_notification_due_idx on public.support_notification_jobs(next_attempt_at)
where status in ('pending','failed','sending');

alter table public.support_messages enable row level security;
alter table public.support_notification_jobs enable row level security;
revoke all on public.support_messages, public.support_notification_jobs from anon, authenticated;
grant select, delete on public.support_messages to authenticated;
grant select(message_id,status,attempts,last_error) on public.support_notification_jobs to authenticated;
grant all on public.support_messages, public.support_notification_jobs to service_role;
drop policy if exists support_admin_read on public.support_messages;
create policy support_admin_read on public.support_messages for select to authenticated
using (public.support_is_admin());
drop policy if exists support_admin_delete on public.support_messages;
create policy support_admin_delete on public.support_messages for delete to authenticated
using (public.support_is_admin());
drop policy if exists support_admin_status on public.support_notification_jobs;
create policy support_admin_status on public.support_notification_jobs for select to authenticated
using (public.support_is_admin());

create or replace function public.support_store_message(p_message jsonb, p_payload jsonb, p_suppressed boolean)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := (p_message->>'id')::uuid; v_provider uuid := (p_message->>'provider_email_id')::uuid;
begin
  insert into public.support_notification_jobs(provider_email_id,message_id,payload,status)
  values(v_provider,v_id,p_payload,case when p_suppressed then 'suppressed' else 'pending' end)
  on conflict(provider_email_id) do nothing;
  if not found then
    select message_id into v_id from public.support_notification_jobs where provider_email_id = v_provider;
    return v_id;
  end if;
  insert into public.support_messages(id,provider_email_id,sender,recipients,cc,subject,message_id,
    received_at,text_body,html_body,attachments)
  values(v_id,v_provider,p_message->>'sender',
    array(select jsonb_array_elements_text(p_message->'recipients')),
    array(select jsonb_array_elements_text(p_message->'cc')),p_message->>'subject',
    p_message->>'message_id',(p_message->>'received_at')::timestamptz,
    p_message->>'text_body',p_message->>'html_body',p_message->'attachments');
  return v_id;
end $$;

create or replace function public.support_claim_notification(p_provider uuid default null)
returns setof public.support_notification_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_provider uuid;
begin
  -- Stop ambiguous retries BEFORE Resend's 24-hour idempotency key expires.
  update public.support_notification_jobs set status = 'needs_review', lease_token = null,
    last_error = 'Retry limit or idempotency safety window reached; check Resend delivery before taking action'
  where status in ('pending','failed','sending')
    and (first_attempt_at < now() - interval '23 hours' or attempts >= 12)
    and (lease_until is null or lease_until < now());
  select provider_email_id into v_provider from public.support_notification_jobs
  where (p_provider is null or provider_email_id = p_provider)
    and status in ('pending','failed','sending') and next_attempt_at <= now()
    and (lease_until is null or lease_until < now())
  order by next_attempt_at for update skip locked limit 1;
  if v_provider is null then return; end if;
  return query update public.support_notification_jobs set status = 'sending',
    attempts = attempts + 1, first_attempt_at = coalesce(first_attempt_at,now()),
    lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'
  where provider_email_id = v_provider returning *;
end $$;

create or replace function public.support_delete_notification_payload()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.support_notification_jobs set payload = null,
    status = case when status = 'sent' then 'sent' else 'suppressed' end,
    lease_token = null, lease_until = null, last_error = null
  where provider_email_id = old.provider_email_id;
  return old;
end $$;
drop trigger if exists support_delete_notification_payload on public.support_messages;
create trigger support_delete_notification_payload after delete on public.support_messages
for each row execute function public.support_delete_notification_payload();

revoke all on function public.support_store_message(jsonb,jsonb,boolean),
  public.support_claim_notification(uuid), public.support_delete_notification_payload(),
  public.support_protect_profile_role() from public, anon, authenticated;
grant execute on function public.support_store_message(jsonb,jsonb,boolean),
  public.support_claim_notification(uuid) to service_role;
commit;
