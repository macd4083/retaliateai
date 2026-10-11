-- Apply after 20261010. A protected, transaction-scoped capability authorizes
-- only the single timing mutation made by the current-day RPC, never a GUC.
do $day_schedule$
begin
execute $ddl$
create table if not exists public.today_v2_day_schedule_writes (
  backend_pid integer not null,
  transaction_id bigint not null,
  user_id uuid not null,
  target_local_date date not null,
  timezone_name text not null,
  source_id uuid not null,
  source_type text not null,
  schedule_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  primary key (backend_pid, transaction_id)
);
alter table public.today_v2_day_schedule_writes enable row level security;
revoke all on public.today_v2_day_schedule_writes from public, anon, authenticated, service_role;

create or replace function public.today_v2_guard_schedule_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_date date;
  v_review_id uuid;
  v_write public.today_v2_day_schedule_writes;
  v_row public.today_v2_schedule_blocks;
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1
    and not exists (select 1 from public.today_v2_daily_reviews where id = old.source_review_id and user_id = old.user_id) then
    return old;
  end if;
  select * into v_write from public.today_v2_day_schedule_writes
  where backend_pid = pg_backend_pid() and transaction_id = txid_current();
  if found then
    if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
    if auth.uid() is distinct from v_write.user_id
      or v_row.user_id is distinct from v_write.user_id
      or v_row.target_local_date is distinct from v_write.target_local_date
      or v_row.timezone_name is distinct from v_write.timezone_name
      or v_write.target_local_date <> (statement_timestamp() at time zone v_write.timezone_name)::date
      or (case when v_write.source_type = 'action' then v_row.commitment_fragment_id else v_row.habit_definition_id end)
        is distinct from v_write.source_id
      or (tg_op <> 'INSERT' and v_row.id is distinct from v_write.schedule_id)
      or (tg_op = 'DELETE' and (v_write.starts_at is not null or v_write.ends_at is not null))
      or (tg_op <> 'DELETE' and (v_row.starts_at is distinct from v_write.starts_at
        or v_row.ends_at is distinct from v_write.ends_at or v_write.starts_at is null))
      or (tg_op = 'UPDATE' and (to_jsonb(new) - array['starts_at','ends_at','is_automatic','updated_at'])
        <> (to_jsonb(old) - array['starts_at','ends_at','is_automatic','updated_at']))
      or (tg_op <> 'DELETE' and v_row.is_automatic
        and (tg_op = 'INSERT' or not old.is_automatic or new.starts_at is distinct from old.starts_at
          or new.ends_at is distinct from old.ends_at)) then
      raise exception 'Invalid current-day schedule mutation';
    end if;
    if v_row.commitment_fragment_id is not null then
      select source_local_date into strict v_date from public.today_v2_commitment_fragments
      where id = v_row.commitment_fragment_id and user_id = v_row.user_id
        and target_local_date = v_row.target_local_date;
    else
      v_date := v_row.target_local_date - 1;
    end if;
    if v_date not in (v_row.target_local_date - 1, v_row.target_local_date) then
      raise exception 'Historical or carryover sources cannot be scheduled';
    end if;
    select id into strict v_review_id from public.today_v2_daily_reviews
    where user_id = v_row.user_id and local_date = v_date for update;
    perform public.today_v2_lock_source_review(v_row.user_id, v_row.target_local_date, v_row.timezone_name);
    if v_row.source_review_id is not null and v_row.source_review_id <> v_review_id then
      raise exception 'Schedule source review must match its owned source';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    new.source_review_id := v_review_id;
    return new;
  end if;
  -- Existing plan/replacement/recurrence writers retain their original guards.
  if tg_op <> 'INSERT' then
    select local_date into strict v_date from public.today_v2_daily_reviews
    where id = old.source_review_id and user_id = old.user_id;
    perform public.today_v2_lock_source_review(old.user_id, v_date, old.timezone_name);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.commitment_fragment_id is not null then
    select source_local_date into strict v_date from public.today_v2_commitment_fragments
    where id = new.commitment_fragment_id and user_id = new.user_id and target_local_date = new.target_local_date;
  else
    v_date := new.target_local_date - 1;
  end if;
  if tg_op = 'INSERT' and new.is_automatic and new.habit_definition_id is not null and auth.uid() = new.user_id then
    insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
    values(new.user_id,v_date,new.timezone_name) on conflict (user_id,local_date) do nothing;
    select id into strict v_review_id from public.today_v2_daily_reviews
    where user_id = new.user_id and local_date = v_date for update;
    perform public.today_v2_lock_source_review(new.user_id,new.target_local_date,new.timezone_name);
  else
    v_review_id := public.today_v2_lock_source_review(new.user_id,v_date,new.timezone_name);
  end if;
  if new.source_review_id is not null and new.source_review_id <> v_review_id then
    raise exception 'Schedule source review must match its owned source';
  end if;
  new.source_review_id := v_review_id;
  return new;
end;
$$;

create or replace function public.today_v2_update_day_schedule(
  p_target_local_date date, p_timezone_name text, p_source_type text,
  p_source_id uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
returns setof public.today_v2_schedule_blocks
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_existing public.today_v2_schedule_blocks;
  v_review public.today_v2_daily_reviews;
  v_changed boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_target_local_date is null or not isfinite(p_target_local_date)
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name)
    or p_source_type is null or p_source_type not in ('action','habit') or p_source_id is null then
    raise exception 'Valid current date, timezone, and owned schedule source required';
  end if;
  if p_target_local_date <> (statement_timestamp() at time zone p_timezone_name)::date then
    raise exception 'Only the current civil local date can be edited';
  end if;
  if (p_starts_at is null) <> (p_ends_at is null)
    or (p_starts_at is not null and (not isfinite(p_starts_at) or not isfinite(p_ends_at)
      or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '24 hours'
      or (p_starts_at at time zone p_timezone_name)::date <> p_target_local_date)) then
    raise exception 'Valid same-day start and elapsed duration of at most 24 hours required';
  end if;
  -- Lock source, then target review, then the shared per-target advisory lock.
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
  select v_user,p_target_local_date - 1 + d,p_timezone_name from generate_series(0,1) d
  on conflict (user_id,local_date) do nothing;
  perform 1 from public.today_v2_daily_reviews where user_id = v_user
    and local_date between p_target_local_date - 1 and p_target_local_date order by local_date for update;
  select * into strict v_review from public.today_v2_daily_reviews
  where user_id = v_user and local_date = p_target_local_date;
  if v_review.completed_at is not null then raise exception 'Target review is completed; reopen it before editing'; end if;
  -- The daily workflow's timezone is authoritative; legacy profile defaults
  -- may differ from the browser/workflow timezone, particularly during travel.
  if v_review.timezone_name <> p_timezone_name then raise exception 'Timezone must match the target daily review'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_target_local_date::text,0));
  if p_source_type = 'action' then
    perform 1 from public.today_v2_commitment_fragments where user_id = v_user and id = p_source_id
      and target_local_date = p_target_local_date
      and source_local_date in (p_target_local_date - 1, p_target_local_date);
    if not found then raise exception 'Action must belong to user and current target date'; end if;
  else
    perform 1 from public.today_v2_habit_definitions where user_id = v_user and id = p_source_id;
    if not found then raise exception 'Habit must belong to authenticated user'; end if;
  end if;
  select * into v_existing from public.today_v2_schedule_blocks where user_id = v_user
    and target_local_date = p_target_local_date and
    (case when p_source_type = 'action' then commitment_fragment_id else habit_definition_id end) = p_source_id;
  if found and v_existing.timezone_name <> p_timezone_name then
    raise exception 'Timezone must match the existing schedule';
  end if;
  v_changed := v_existing.id is null or
    (v_existing.starts_at,v_existing.ends_at) is distinct from (p_starts_at,p_ends_at);
  if p_source_type = 'habit' and v_changed then
    insert into public.today_v2_habit_schedule_overrides(user_id,target_local_date,habit_definition_id)
    values(v_user,p_target_local_date,p_source_id) on conflict do nothing;
  end if;
  insert into public.today_v2_day_schedule_writes
    values(pg_backend_pid(),txid_current(),v_user,p_target_local_date,p_timezone_name,
      p_source_id,p_source_type,v_existing.id,p_starts_at,p_ends_at);
  if p_starts_at is null then
    delete from public.today_v2_schedule_blocks where id = v_existing.id;
  elsif v_existing.id is not null then
    if v_changed then
      update public.today_v2_schedule_blocks set starts_at = p_starts_at,ends_at = p_ends_at,is_automatic = false
      where id = v_existing.id;
    end if;
  else
    insert into public.today_v2_schedule_blocks(
      user_id,target_local_date,timezone_name,commitment_fragment_id,habit_definition_id,starts_at,ends_at
    ) values(v_user,p_target_local_date,p_timezone_name,
      case when p_source_type = 'action' then p_source_id end,
      case when p_source_type = 'habit' then p_source_id end,p_starts_at,p_ends_at);
  end if;
  delete from public.today_v2_day_schedule_writes
  where backend_pid = pg_backend_pid() and transaction_id = txid_current();
  return query select * from public.today_v2_schedule_blocks
  where user_id = v_user and target_local_date = p_target_local_date order by starts_at,id;
end;
$$;
revoke all on function public.today_v2_guard_schedule_review() from public,anon,authenticated;
revoke all on function public.today_v2_update_day_schedule(date,text,text,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.today_v2_update_day_schedule(date,text,text,uuid,timestamptz,timestamptz) to authenticated;
notify pgrst, 'reload schema';
$ddl$;
end;
$day_schedule$;
