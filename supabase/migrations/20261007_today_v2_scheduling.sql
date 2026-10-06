-- Stable commitment identities, owned schedules, and backend-only Google credentials.
alter table public.today_v2_plan_inputs
  add column if not exists first_five_minutes text;

create unique index if not exists idx_today_v2_fragments_owner_date_id
  on public.today_v2_commitment_fragments(user_id, target_local_date, id);

create table if not exists public.today_v2_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_local_date date not null,
  timezone_name text not null,
  commitment_fragment_id uuid,
  habit_definition_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_schedule_source_check check (
    (commitment_fragment_id is not null) <> (habit_definition_id is not null)
  ),
  constraint today_v2_schedule_time_check check (
    isfinite(starts_at) and isfinite(ends_at)
    and ends_at > starts_at and ends_at - starts_at <= interval '24 hours'
  ),
  constraint today_v2_schedule_fragment_owner_fk
    foreign key (user_id, target_local_date, commitment_fragment_id)
    references public.today_v2_commitment_fragments(user_id, target_local_date, id) on delete cascade,
  constraint today_v2_schedule_habit_owner_fk
    foreign key (user_id, habit_definition_id)
    references public.today_v2_habit_definitions(user_id, id) on delete cascade,
  constraint today_v2_schedule_fragment_date_unique unique (user_id, target_local_date, commitment_fragment_id),
  constraint today_v2_schedule_habit_date_unique unique (user_id, target_local_date, habit_definition_id)
);

create or replace function public.today_v2_validate_schedule_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone_name) then
    raise exception 'Invalid schedule timezone';
  end if;
  if (new.starts_at at time zone new.timezone_name)::date <> new.target_local_date then
    raise exception 'Schedule start must fall on target local date';
  end if;
  if new.habit_definition_id is not null then
    perform 1 from public.today_v2_habit_definitions
    where user_id = new.user_id and id = new.habit_definition_id
      and not is_archived
      and extract(dow from new.target_local_date)::smallint = any(schedule_weekdays)
    for share;
    if not found then
      raise exception 'Schedule habit must be owned, active, and scheduled on target weekday';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists today_v2_schedule_validate on public.today_v2_schedule_blocks;
create trigger today_v2_schedule_validate before insert or update on public.today_v2_schedule_blocks
  for each row execute function public.today_v2_validate_schedule_block();
drop trigger if exists today_v2_schedule_set_updated_at on public.today_v2_schedule_blocks;
create trigger today_v2_schedule_set_updated_at before update on public.today_v2_schedule_blocks
  for each row execute function public.today_v2_touch_updated_at();

create or replace function public.today_v2_archive_habit_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_archived and not old.is_archived then
    delete from public.today_v2_schedule_blocks
    where user_id = new.user_id and habit_definition_id = new.id and starts_at >= now()
      and not exists (
        select 1 from public.today_v2_daily_reviews r
        where r.user_id = new.user_id
          and r.local_date = today_v2_schedule_blocks.target_local_date
          and r.completed_at is not null
      );
  end if;
  return new;
end;
$$;
drop trigger if exists today_v2_archive_habit_schedule on public.today_v2_habit_definitions;
create trigger today_v2_archive_habit_schedule after update of is_archived on public.today_v2_habit_definitions
  for each row execute function public.today_v2_archive_habit_schedule();

alter table public.today_v2_schedule_blocks enable row level security;
drop policy if exists "today_v2 schedule select" on public.today_v2_schedule_blocks;
create policy "today_v2 schedule select" on public.today_v2_schedule_blocks for select to authenticated
  using (auth.uid() = user_id);
revoke all on public.today_v2_schedule_blocks from public, anon, authenticated;
grant select on public.today_v2_schedule_blocks to authenticated;
grant all on public.today_v2_schedule_blocks to service_role;

drop policy if exists "today_v2 unanswered fragments delete" on public.today_v2_commitment_fragments;
revoke delete on public.today_v2_commitment_fragments from authenticated;

create or replace function public.today_v2_replace_plan_stable(
  p_target_local_date date, p_source_local_date date, p_timezone_name text,
  p_raw_plan_text text, p_fragment_texts text[], p_fragment_ids uuid[],
  p_first_five_minutes text default null
)
returns setof public.today_v2_commitment_fragments
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_offset integer;
  v_entry record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_target_local_date is null or p_source_local_date is null
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name) then
    raise exception 'Valid dates and timezone required';
  end if;
  if coalesce(cardinality(p_fragment_texts), 0) <> coalesce(cardinality(p_fragment_ids), 0)
    or coalesce(array_ndims(p_fragment_texts), 1) <> 1
    or coalesce(array_ndims(p_fragment_ids), 1) <> 1 then
    raise exception 'Fragment texts and IDs must be matching one-dimensional arrays';
  end if;
  if exists (select 1 from unnest(p_fragment_texts) t where t is null or trim(t) = '') then
    raise exception 'Fragment text must not be empty';
  end if;
  if exists (select 1 from unnest(p_fragment_ids) i where i is not null group by i having count(*) > 1) then
    raise exception 'Duplicate fragment IDs';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_target_local_date::text, 0));
  perform 1 from public.today_v2_commitment_fragments
    where user_id = v_user_id and target_local_date = p_target_local_date for update;
  if exists (
    select 1 from unnest(p_fragment_ids) i where i is not null and not exists (
      select 1 from public.today_v2_commitment_fragments f
      where f.id = i and f.user_id = v_user_id and f.target_local_date = p_target_local_date
    )
  ) then raise exception 'Fragment ID must belong to user and target date'; end if;
  if exists (select 1 from public.today_v2_commitment_fragments
    where user_id = v_user_id and target_local_date = p_target_local_date and completion_state <> 'unanswered') then
    raise exception 'Cannot overwrite answered fragments';
  end if;
  delete from public.today_v2_commitment_fragments
    where user_id = v_user_id and target_local_date = p_target_local_date
      and not (id = any(array_remove(coalesce(p_fragment_ids, '{}'::uuid[]), null)));
  if coalesce(cardinality(p_fragment_texts), 0) = 0
    and trim(coalesce(p_raw_plan_text, '')) = ''
    and trim(coalesce(p_first_five_minutes, '')) = '' then
    delete from public.today_v2_plan_inputs where user_id = v_user_id and target_local_date = p_target_local_date;
    return;
  end if;
  insert into public.today_v2_plan_inputs (
    user_id, source_local_date, target_local_date, timezone_name, raw_plan_text, first_five_minutes
  ) values (
    v_user_id, p_source_local_date, p_target_local_date, p_timezone_name,
    coalesce(p_raw_plan_text, ''), nullif(trim(coalesce(p_first_five_minutes, '')), '')
  ) on conflict (user_id, target_local_date) do update set
    source_local_date = excluded.source_local_date, timezone_name = excluded.timezone_name,
    raw_plan_text = excluded.raw_plan_text, first_five_minutes = excluded.first_five_minutes
  returning id into v_plan_id;
  -- Keep the immediate unique constraint usable by legacy ON CONFLICT callers.
  select coalesce(max(fragment_order), -1) + coalesce(cardinality(p_fragment_texts), 0) + 1
    into v_offset from public.today_v2_commitment_fragments
    where user_id = v_user_id and target_local_date = p_target_local_date;
  update public.today_v2_commitment_fragments set fragment_order = fragment_order + v_offset
    where user_id = v_user_id and target_local_date = p_target_local_date;
  for v_entry in select t, i, ord from unnest(p_fragment_texts, p_fragment_ids) with ordinality as x(t, i, ord) loop
    if v_entry.i is null then
      insert into public.today_v2_commitment_fragments (
        plan_input_id, user_id, source_local_date, target_local_date, timezone_name,
        fragment_order, fragment_text, normalized_fragment_text
      ) values (
        v_plan_id, v_user_id, p_source_local_date, p_target_local_date, p_timezone_name,
        v_entry.ord - 1, trim(v_entry.t), regexp_replace(trim(v_entry.t), '\s+', ' ', 'g')
      );
    else
      update public.today_v2_commitment_fragments set
        plan_input_id = v_plan_id, source_local_date = p_source_local_date, timezone_name = p_timezone_name,
        fragment_order = v_entry.ord - 1, fragment_text = trim(v_entry.t),
        normalized_fragment_text = regexp_replace(trim(v_entry.t), '\s+', ' ', 'g')
      where id = v_entry.i and user_id = v_user_id and target_local_date = p_target_local_date;
    end if;
  end loop;
  return query select * from public.today_v2_commitment_fragments
    where user_id = v_user_id and target_local_date = p_target_local_date order by fragment_order;
end;
$$;

-- Legacy positional callers retain IDs, but changed text cannot inherit a time block.
-- One defaulted signature supports five and six arguments without overload ambiguity.
drop function if exists public.today_v2_replace_plan_for_date(date, date, text, text, text[]);
create or replace function public.today_v2_replace_plan_for_date(
  p_target_local_date date, p_source_local_date date, p_timezone_name text,
  p_raw_plan_text text, p_fragment_texts text[], p_first_five_minutes text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_texts text[];
  v_ids uuid[];
begin
  if auth.uid() is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_target_local_date::text, 0));
  delete from public.today_v2_schedule_blocks b using public.today_v2_commitment_fragments f
  where b.commitment_fragment_id = f.id and f.user_id = auth.uid() and f.target_local_date = p_target_local_date
    and not exists (
      select 1 from unnest(p_fragment_texts) with ordinality x(t, ord)
      where ord - 1 = f.fragment_order and trim(t) = f.fragment_text
    );
  select coalesce(array_agg(trim(x.t) order by x.ord), '{}'::text[]),
    coalesce(array_agg(f.id order by x.ord), '{}'::uuid[])
  into v_texts, v_ids
  from unnest(p_fragment_texts) with ordinality x(t, ord)
  left join public.today_v2_commitment_fragments f
    on f.user_id = auth.uid() and f.target_local_date = p_target_local_date and f.fragment_order = x.ord - 1
  where trim(x.t) <> '';
  perform public.today_v2_replace_plan_stable(p_target_local_date, p_source_local_date, p_timezone_name,
    p_raw_plan_text, v_texts, v_ids, p_first_five_minutes);
end;
$$;

create or replace function public.today_v2_replace_schedule(
  p_target_local_date date, p_timezone_name text, p_blocks jsonb
)
returns setof public.today_v2_schedule_blocks
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_target_local_date is null
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name)
    or p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'Valid target date, timezone, and block array required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_blocks) b where jsonb_typeof(b) <> 'object') then
    raise exception 'Each schedule block must be an object';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_target_local_date::text, 0));
  delete from public.today_v2_schedule_blocks where user_id = v_user_id and target_local_date = p_target_local_date;
  insert into public.today_v2_schedule_blocks (
    user_id, target_local_date, timezone_name, commitment_fragment_id, habit_definition_id, starts_at, ends_at
  )
  select v_user_id, p_target_local_date, p_timezone_name,
    b.commitment_fragment_id, b.habit_definition_id, b.starts_at, b.ends_at
  from jsonb_to_recordset(p_blocks) as b(
    commitment_fragment_id uuid, habit_definition_id uuid, starts_at timestamptz, ends_at timestamptz
  );
  return query select * from public.today_v2_schedule_blocks
    where user_id = v_user_id and target_local_date = p_target_local_date order by starts_at, id;
end;
$$;

revoke all on function public.today_v2_replace_plan_stable(date, date, text, text, text[], uuid[], text) from public, anon;
revoke all on function public.today_v2_replace_plan_for_date(date, date, text, text, text[], text) from public, anon;
revoke all on function public.today_v2_replace_schedule(date, text, jsonb) from public, anon;
grant execute on function public.today_v2_replace_plan_stable(date, date, text, text, text[], uuid[], text) to authenticated;
grant execute on function public.today_v2_replace_plan_for_date(date, date, text, text, text[], text) to authenticated;
grant execute on function public.today_v2_replace_schedule(date, text, jsonb) to authenticated;

create table if not exists public.today_v2_google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tokens_encrypted text not null,
  selected_calendar_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists public.today_v2_google_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  verifier_encrypted text not null,
  return_path text not null
);
create index if not exists idx_today_v2_google_states_expires
  on public.today_v2_google_oauth_states(expires_at);
alter table public.today_v2_google_connections enable row level security;
alter table public.today_v2_google_oauth_states enable row level security;
revoke all on public.today_v2_google_connections, public.today_v2_google_oauth_states from public, anon, authenticated;
grant all on public.today_v2_google_connections, public.today_v2_google_oauth_states to service_role;
drop trigger if exists today_v2_google_connections_set_updated_at on public.today_v2_google_connections;
create trigger today_v2_google_connections_set_updated_at before update on public.today_v2_google_connections
  for each row execute function public.today_v2_touch_updated_at();

create or replace function public.today_v2_consume_google_state(p_state_hash text)
returns setof public.today_v2_google_oauth_states
language sql security definer set search_path = public as $$
  delete from public.today_v2_google_oauth_states
  where state_hash = p_state_hash and expires_at > now()
  returning *;
$$;
revoke all on function public.today_v2_consume_google_state(text) from public, anon, authenticated;
grant execute on function public.today_v2_consume_google_state(text) to service_role;
revoke all on function public.today_v2_validate_schedule_block() from public, anon, authenticated;
revoke all on function public.today_v2_archive_habit_schedule() from public, anon, authenticated;

notify pgrst, 'reload schema';
