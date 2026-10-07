-- Apply after the scheduling review-lock and completion guards.
-- Recurrence uses elapsed-minute durations, skips nonexistent wall times, and
-- chooses the requested instant when a local time occurs twice.
do $recurrence$
begin
execute $ddl$
create or replace function public.today_v2_valid_habit_times(p_times jsonb, p_mode text, p_weekdays smallint[])
returns boolean language plpgsql immutable set search_path = public as $$
declare v_entry record;
begin
  if p_times is null or jsonb_typeof(p_times) <> 'object' then return false; end if;
  for v_entry in select * from jsonb_each(p_times) loop
    if v_entry.key !~ '^[0-6]$' or jsonb_typeof(v_entry.value) <> 'object'
      or coalesce(v_entry.value->>'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(v_entry.value->'duration_minutes') is distinct from 'number'
      or coalesce(v_entry.value->>'occurrence', '') not in ('earlier', 'later') then return false; end if;
    if (v_entry.value->>'duration_minutes')::numeric <> trunc((v_entry.value->>'duration_minutes')::numeric)
      or (v_entry.value->>'duration_minutes')::numeric not between 1 and 1440 then return false; end if;
  end loop;
  if p_mode = 'automatic' and exists (
    select 1 from unnest(p_weekdays) d where not p_times ? d::text
  ) then return false; end if;
  return true;
end;
$$;

alter table public.today_v2_habit_definitions
  add column if not exists planning_mode text not null default 'manual',
  add column if not exists schedule_times jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'today_v2_habit_recurrence_check'
    and conrelid = 'public.today_v2_habit_definitions'::regclass) then
    alter table public.today_v2_habit_definitions add constraint today_v2_habit_recurrence_check
      check (planning_mode in ('manual','automatic')
        and public.today_v2_valid_habit_times(schedule_times, planning_mode, schedule_weekdays));
  end if;
end;
$$;
alter table public.today_v2_schedule_blocks add column if not exists is_automatic boolean not null default false;

-- Only the authorized seeder writes new is_automatic rows: authenticated users
-- have no table write grants, and the manual replacement RPC never sets it on
-- insertion. Missing recurrence may materialize after source completion, but
-- existing schedule evidence and completed target days remain immutable.
create or replace function public.today_v2_guard_schedule_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_date date; v_review_id uuid;
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1
    and not exists (select 1 from public.today_v2_daily_reviews where id = old.source_review_id and user_id = old.user_id) then
    return old;
  end if;
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
  if tg_op = 'INSERT' and new.is_automatic and new.habit_definition_id is not null
    and auth.uid() = new.user_id then
    insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
    values(new.user_id,v_date,new.timezone_name) on conflict (user_id,local_date) do nothing;
    select id into strict v_review_id from public.today_v2_daily_reviews
    where user_id = new.user_id and local_date = v_date for update;
    perform public.today_v2_lock_source_review(new.user_id,new.target_local_date,new.timezone_name);
  else
    v_review_id := public.today_v2_lock_source_review(new.user_id, v_date, new.timezone_name);
  end if;
  if new.source_review_id is not null and new.source_review_id <> v_review_id then
    raise exception 'Schedule source review must match its owned source';
  end if;
  new.source_review_id := v_review_id;
  return new;
end;
$$;

-- Presence means the user changed or removed this occurrence. An absent block
-- with an override is a tombstone, not an invitation to seed it again.
create table if not exists public.today_v2_habit_schedule_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_local_date date not null,
  habit_definition_id uuid not null,
  primary key (user_id, target_local_date, habit_definition_id),
  foreign key (user_id, habit_definition_id)
    references public.today_v2_habit_definitions(user_id, id) on delete cascade
);
alter table public.today_v2_habit_schedule_overrides enable row level security;
drop policy if exists "today_v2 habit overrides select" on public.today_v2_habit_schedule_overrides;
create policy "today_v2 habit overrides select" on public.today_v2_habit_schedule_overrides
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.today_v2_habit_schedule_overrides from public, anon, authenticated;
grant select on public.today_v2_habit_schedule_overrides to authenticated;
grant all on public.today_v2_habit_schedule_overrides to service_role;

create or replace function public.today_v2_seed_habit_schedules(
  p_start_local_date date, p_end_local_date date, p_timezone_name text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_date date;
  v_habit record;
  v_wall timestamp;
  v_start timestamptz;
  v_source_completed boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_start_local_date is null or p_end_local_date is null
    or not isfinite(p_start_local_date) or not isfinite(p_end_local_date)
    or p_end_local_date < p_start_local_date or p_end_local_date - p_start_local_date > 30
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name) then
    raise exception 'Valid timezone and a date range of at most 31 days required';
  end if;
  -- Match the schedule writer's review-before-target lock order, and protect
  -- both source completion and completed daily evidence from regeneration.
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
  select v_user, p_start_local_date - 1 + d, p_timezone_name
  from generate_series(0, p_end_local_date - p_start_local_date + 1) d
  on conflict (user_id,local_date) do nothing;
  perform 1 from public.today_v2_daily_reviews
  where user_id = v_user and local_date between p_start_local_date - 1 and p_end_local_date
  order by local_date for update;
  for v_date in select p_start_local_date + d from generate_series(0, p_end_local_date - p_start_local_date) d loop
    if exists (select 1 from public.today_v2_daily_reviews where user_id = v_user
      and local_date = v_date and completed_at is not null) then continue; end if;
    v_source_completed := exists (select 1 from public.today_v2_daily_reviews where user_id = v_user
      and local_date = v_date - 1 and completed_at is not null);
    perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_date::text, 0));
    delete from public.today_v2_schedule_blocks b
    where b.user_id = v_user and b.target_local_date = v_date and b.is_automatic and not v_source_completed
      and not exists (select 1 from public.today_v2_habit_definitions h
        where h.user_id = v_user and h.id = b.habit_definition_id
          and not h.is_archived and h.planning_mode = 'automatic'
          and extract(dow from v_date)::smallint = any(h.schedule_weekdays));
    for v_habit in
      select h.id, h.schedule_times -> (extract(dow from v_date)::integer::text) as slot
      from public.today_v2_habit_definitions h
      where h.user_id = v_user and not h.is_archived and h.planning_mode = 'automatic'
        and extract(dow from v_date)::smallint = any(h.schedule_weekdays)
        and not exists (select 1 from public.today_v2_habit_schedule_overrides o
          where o.user_id = v_user and o.target_local_date = v_date and o.habit_definition_id = h.id)
      order by h.id for share
    loop
      v_wall := v_date + (v_habit.slot->>'time')::time;
      -- Enumerate nearby timezone offsets and round-trip each candidate.
      -- PostgreSQL's default AT TIME ZONE fold choice alone is insufficient.
      select case when v_habit.slot->>'occurrence' = 'later' then max(candidate) else min(candidate) end
      into v_start from (
        select distinct (v_wall at time zone 'UTC')
          - ((sample at time zone p_timezone_name) - (sample at time zone 'UTC')) as candidate
        from generate_series((v_wall at time zone 'UTC') - interval '36 hours',
          (v_wall at time zone 'UTC') + interval '36 hours', interval '6 hours') sample
      ) candidates where candidate at time zone p_timezone_name = v_wall;
      if v_start is null then
        delete from public.today_v2_schedule_blocks where user_id = v_user
          and target_local_date = v_date and habit_definition_id = v_habit.id and is_automatic and not v_source_completed;
        continue;
      end if;
      insert into public.today_v2_schedule_blocks(
        user_id,target_local_date,timezone_name,habit_definition_id,starts_at,ends_at,is_automatic
      ) values(v_user,v_date,p_timezone_name,v_habit.id,v_start,
        v_start + (v_habit.slot->>'duration_minutes')::integer * interval '1 minute',true)
      on conflict (user_id,target_local_date,habit_definition_id) do update set
        timezone_name = excluded.timezone_name, starts_at = excluded.starts_at, ends_at = excluded.ends_at
      where today_v2_schedule_blocks.is_automatic and not v_source_completed
        and (today_v2_schedule_blocks.timezone_name, today_v2_schedule_blocks.starts_at, today_v2_schedule_blocks.ends_at)
          is distinct from (excluded.timezone_name, excluded.starts_at, excluded.ends_at);
    end loop;
  end loop;
end;
$$;

create or replace function public.today_v2_replace_schedule(
  p_target_local_date date, p_timezone_name text, p_blocks jsonb
)
returns setof public.today_v2_schedule_blocks
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_block record; v_existing public.today_v2_schedule_blocks;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_target_local_date is null or not isfinite(p_target_local_date)
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name)
    or p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'Valid target date, timezone, and block array required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_blocks) b where jsonb_typeof(b) <> 'object') then
    raise exception 'Each schedule block must be an object';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_blocks) as x(commitment_fragment_id uuid,habit_definition_id uuid)
    where (x.commitment_fragment_id is null) = (x.habit_definition_id is null)) then
    raise exception 'Each block needs exactly one action or habit source';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_blocks) as x(commitment_fragment_id uuid,habit_definition_id uuid)
    group by commitment_fragment_id,habit_definition_id having count(*) > 1) then
    raise exception 'Duplicate schedule sources';
  end if;
  perform public.today_v2_lock_source_review(v_user, p_target_local_date - 1, p_timezone_name);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_target_local_date::text, 0));
  -- Validate owned habit identities even for tombstones, before recording them.
  if exists (select 1 from jsonb_to_recordset(p_blocks) as x(habit_definition_id uuid)
    where x.habit_definition_id is not null and not exists (
      select 1 from public.today_v2_habit_definitions h where h.id = x.habit_definition_id and h.user_id = v_user
    )) then raise exception 'Habit must belong to authenticated user'; end if;
  insert into public.today_v2_habit_schedule_overrides(user_id,target_local_date,habit_definition_id)
  select v_user,p_target_local_date,coalesce(b.habit_definition_id,x.habit_definition_id)
  from (select * from public.today_v2_schedule_blocks
    where user_id = v_user and target_local_date = p_target_local_date and habit_definition_id is not null) b
  full join jsonb_to_recordset(p_blocks) as x(habit_definition_id uuid, starts_at timestamptz, ends_at timestamptz)
    on x.habit_definition_id = b.habit_definition_id
  where coalesce(b.habit_definition_id,x.habit_definition_id) is not null
    and (b.starts_at,b.ends_at,b.timezone_name) is distinct from (x.starts_at,x.ends_at,p_timezone_name)
  on conflict do nothing;
  -- Unchanged automatic rows retain their provenance and UUID; modified rows
  -- become manual and seeding can never overwrite them.
  delete from public.today_v2_schedule_blocks b where b.user_id = v_user
    and b.target_local_date = p_target_local_date and not exists (
      select 1 from jsonb_to_recordset(p_blocks) as x(commitment_fragment_id uuid,habit_definition_id uuid)
      where x.commitment_fragment_id = b.commitment_fragment_id or x.habit_definition_id = b.habit_definition_id
    );
  for v_block in select * from jsonb_to_recordset(p_blocks) as x(
    commitment_fragment_id uuid,habit_definition_id uuid,starts_at timestamptz,ends_at timestamptz
  ) loop
    select * into v_existing from public.today_v2_schedule_blocks b
    where b.user_id = v_user and b.target_local_date = p_target_local_date
      and (b.commitment_fragment_id = v_block.commitment_fragment_id or b.habit_definition_id = v_block.habit_definition_id);
    if found then
      update public.today_v2_schedule_blocks set
        timezone_name = p_timezone_name, starts_at = v_block.starts_at, ends_at = v_block.ends_at,
        is_automatic = v_existing.is_automatic and v_existing.timezone_name = p_timezone_name
          and v_existing.starts_at = v_block.starts_at and v_existing.ends_at = v_block.ends_at
      where id = v_existing.id;
    else
      insert into public.today_v2_schedule_blocks(
        user_id,target_local_date,timezone_name,commitment_fragment_id,habit_definition_id,starts_at,ends_at
      ) values(v_user,p_target_local_date,p_timezone_name,
        v_block.commitment_fragment_id,v_block.habit_definition_id,v_block.starts_at,v_block.ends_at);
    end if;
  end loop;
  return query select * from public.today_v2_schedule_blocks
    where user_id = v_user and target_local_date = p_target_local_date order by starts_at,id;
end;
$$;

revoke all on function public.today_v2_seed_habit_schedules(date,date,text) from public,anon;
revoke all on function public.today_v2_guard_schedule_review() from public,anon,authenticated;
grant execute on function public.today_v2_seed_habit_schedules(date,date,text) to authenticated;
revoke all on function public.today_v2_replace_schedule(date,text,jsonb) from public,anon;
grant execute on function public.today_v2_replace_schedule(date,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
$ddl$;
end;
$recurrence$;
