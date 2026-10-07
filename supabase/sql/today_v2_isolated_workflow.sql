-- Today V2 isolated workflow schema
-- Public-prefix fallback is used instead of a separate schema so Supabase/PostgREST
-- works without additional API schema configuration.

create extension if not exists pgcrypto;

create or replace function public.today_v2_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.today_v2_daily_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  timezone_name text not null,
  desired_direction text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_daily_reviews_user_date_unique unique (user_id, local_date),
  constraint today_v2_daily_reviews_timezone_check check (char_length(trim(timezone_name)) > 0)
);

alter table if exists public.today_v2_daily_reviews
  add column if not exists completed_at timestamptz;

create table if not exists public.today_v2_plan_inputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_local_date date not null,
  target_local_date date not null,
  timezone_name text not null,
  raw_plan_text text not null,
  parser_version text not null default 'commitment-fragmentation-v2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_plan_inputs_user_target_unique unique (user_id, target_local_date),
  constraint today_v2_plan_inputs_timezone_check check (char_length(trim(timezone_name)) > 0)
);

create table if not exists public.today_v2_habit_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seed_key text,
  name text not null,
  response_type text not null,
  unit text,
  schedule_weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  display_order integer not null default 0,
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_habit_definitions_response_type_check check (response_type in ('boolean', 'number')),
  constraint today_v2_habit_definitions_schedule_check check (
    cardinality(schedule_weekdays) > 0
    and schedule_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint today_v2_habit_definitions_display_order_check check (display_order >= 0)
);

create table if not exists public.today_v2_habit_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_definition_id uuid not null references public.today_v2_habit_definitions(id) on delete restrict,
  local_date date not null,
  timezone_name text not null,
  scheduled_weekday smallint not null,
  snapshot_name text not null,
  snapshot_response_type text not null,
  snapshot_unit text,
  snapshot_display_order integer not null default 0,
  boolean_response boolean,
  numeric_response numeric,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_habit_occurrences_user_habit_date_unique unique (user_id, habit_definition_id, local_date),
  constraint today_v2_habit_occurrences_weekday_check check (scheduled_weekday between 0 and 6),
  constraint today_v2_habit_occurrences_response_type_check check (snapshot_response_type in ('boolean', 'number')),
  constraint today_v2_habit_occurrences_display_order_check check (snapshot_display_order >= 0),
  constraint today_v2_habit_occurrences_response_shape_check check (
    (snapshot_response_type = 'boolean' and numeric_response is null)
    or (snapshot_response_type = 'number' and boolean_response is null)
  ),
  constraint today_v2_habit_occurrences_answer_check check (
    (answered_at is null and boolean_response is null and numeric_response is null)
    or (
      answered_at is not null
      and (
        (snapshot_response_type = 'boolean' and boolean_response is not null and numeric_response is null)
        or (snapshot_response_type = 'number' and numeric_response is not null and boolean_response is null)
      )
    )
  ),
  constraint today_v2_habit_occurrences_timezone_check check (char_length(trim(timezone_name)) > 0)
);

create table if not exists public.today_v2_commitment_fragments (
  id uuid primary key default gen_random_uuid(),
  plan_input_id uuid references public.today_v2_plan_inputs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_local_date date not null,
  target_local_date date not null,
  timezone_name text not null,
  fragment_order integer not null,
  fragment_text text not null,
  normalized_fragment_text text not null,
  parser_version text not null default 'commitment-fragmentation-v2',
  completion_state text not null default 'unanswered',
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_commitment_fragments_user_target_order_unique unique (user_id, target_local_date, fragment_order),
  constraint today_v2_commitment_fragments_order_check check (fragment_order >= 0),
  constraint today_v2_commitment_fragments_completion_state_check check (completion_state in ('unanswered', 'kept', 'not_kept')),
  constraint today_v2_commitment_fragments_answer_check check (
    (completion_state = 'unanswered' and answered_at is null)
    or (completion_state in ('kept', 'not_kept') and answered_at is not null)
  ),
  constraint today_v2_commitment_fragments_timezone_check check (char_length(trim(timezone_name)) > 0)
);

create unique index if not exists idx_today_v2_habit_definitions_user_seed_key
  on public.today_v2_habit_definitions(user_id, seed_key)
  where seed_key is not null;

create unique index if not exists idx_today_v2_habit_definitions_user_active_name
  on public.today_v2_habit_definitions(user_id, name)
  where is_archived = false;

create unique index if not exists idx_today_v2_habit_definitions_user_id
  on public.today_v2_habit_definitions(user_id, id);

create index if not exists idx_today_v2_daily_reviews_user_date
  on public.today_v2_daily_reviews(user_id, local_date desc);

create index if not exists idx_today_v2_plan_inputs_user_target
  on public.today_v2_plan_inputs(user_id, target_local_date desc);

create index if not exists idx_today_v2_commitment_fragments_user_target
  on public.today_v2_commitment_fragments(user_id, target_local_date desc, fragment_order asc);

create index if not exists idx_today_v2_habit_definitions_user_active
  on public.today_v2_habit_definitions(user_id, is_archived, display_order asc);

create index if not exists idx_today_v2_habit_occurrences_user_date
  on public.today_v2_habit_occurrences(user_id, local_date desc, snapshot_display_order asc);

create index if not exists idx_today_v2_habit_occurrences_habit_date
  on public.today_v2_habit_occurrences(user_id, habit_definition_id, local_date desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'today_v2_habit_occurrences_owner_fk'
      and conrelid = 'public.today_v2_habit_occurrences'::regclass
  ) then
    alter table public.today_v2_habit_occurrences
      add constraint today_v2_habit_occurrences_owner_fk
      foreign key (user_id, habit_definition_id)
      references public.today_v2_habit_definitions(user_id, id)
      on delete restrict;
  end if;
end $$;

drop trigger if exists today_v2_daily_reviews_set_updated_at on public.today_v2_daily_reviews;
create trigger today_v2_daily_reviews_set_updated_at
before update on public.today_v2_daily_reviews
for each row execute function public.today_v2_touch_updated_at();

drop trigger if exists today_v2_plan_inputs_set_updated_at on public.today_v2_plan_inputs;
create trigger today_v2_plan_inputs_set_updated_at
before update on public.today_v2_plan_inputs
for each row execute function public.today_v2_touch_updated_at();

drop trigger if exists today_v2_habit_definitions_set_updated_at on public.today_v2_habit_definitions;
create trigger today_v2_habit_definitions_set_updated_at
before update on public.today_v2_habit_definitions
for each row execute function public.today_v2_touch_updated_at();

drop trigger if exists today_v2_habit_occurrences_set_updated_at on public.today_v2_habit_occurrences;
create trigger today_v2_habit_occurrences_set_updated_at
before update on public.today_v2_habit_occurrences
for each row execute function public.today_v2_touch_updated_at();

drop trigger if exists today_v2_commitment_fragments_set_updated_at on public.today_v2_commitment_fragments;
create trigger today_v2_commitment_fragments_set_updated_at
before update on public.today_v2_commitment_fragments
for each row execute function public.today_v2_touch_updated_at();

alter table public.today_v2_daily_reviews enable row level security;
alter table public.today_v2_plan_inputs enable row level security;
alter table public.today_v2_habit_definitions enable row level security;
alter table public.today_v2_habit_occurrences enable row level security;
alter table public.today_v2_commitment_fragments enable row level security;

drop policy if exists "today_v2 daily reviews select" on public.today_v2_daily_reviews;
create policy "today_v2 daily reviews select"
  on public.today_v2_daily_reviews
  for select
  using (auth.uid() = user_id);

drop policy if exists "today_v2 daily reviews insert" on public.today_v2_daily_reviews;
create policy "today_v2 daily reviews insert"
  on public.today_v2_daily_reviews
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 daily reviews update" on public.today_v2_daily_reviews;
create policy "today_v2 daily reviews update"
  on public.today_v2_daily_reviews
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 plan inputs select" on public.today_v2_plan_inputs;
create policy "today_v2 plan inputs select"
  on public.today_v2_plan_inputs
  for select
  using (auth.uid() = user_id);

drop policy if exists "today_v2 plan inputs insert" on public.today_v2_plan_inputs;
create policy "today_v2 plan inputs insert"
  on public.today_v2_plan_inputs
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 plan inputs update" on public.today_v2_plan_inputs;
create policy "today_v2 plan inputs update"
  on public.today_v2_plan_inputs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 habit definitions select" on public.today_v2_habit_definitions;
create policy "today_v2 habit definitions select"
  on public.today_v2_habit_definitions
  for select
  using (auth.uid() = user_id);

drop policy if exists "today_v2 habit definitions insert" on public.today_v2_habit_definitions;
create policy "today_v2 habit definitions insert"
  on public.today_v2_habit_definitions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 habit definitions update" on public.today_v2_habit_definitions;
create policy "today_v2 habit definitions update"
  on public.today_v2_habit_definitions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 habit occurrences select" on public.today_v2_habit_occurrences;
create policy "today_v2 habit occurrences select"
  on public.today_v2_habit_occurrences
  for select
  using (auth.uid() = user_id);

drop policy if exists "today_v2 habit occurrences insert" on public.today_v2_habit_occurrences;
create policy "today_v2 habit occurrences insert"
  on public.today_v2_habit_occurrences
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 habit occurrences update" on public.today_v2_habit_occurrences;
create policy "today_v2 habit occurrences update"
  on public.today_v2_habit_occurrences
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 commitment fragments select" on public.today_v2_commitment_fragments;
create policy "today_v2 commitment fragments select"
  on public.today_v2_commitment_fragments
  for select
  using (auth.uid() = user_id);

drop policy if exists "today_v2 commitment fragments insert" on public.today_v2_commitment_fragments;
create policy "today_v2 commitment fragments insert"
  on public.today_v2_commitment_fragments
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "today_v2 commitment fragments update" on public.today_v2_commitment_fragments;
create policy "today_v2 commitment fragments update"
  on public.today_v2_commitment_fragments
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.today_v2_daily_reviews to authenticated;
grant select, insert, update on public.today_v2_plan_inputs to authenticated;
grant select, insert, update on public.today_v2_habit_definitions to authenticated;
grant select, insert, update on public.today_v2_habit_occurrences to authenticated;
grant select, insert, update on public.today_v2_commitment_fragments to authenticated;

create or replace function public.today_v2_seed_default_habits_for_user(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return;
  end if;

  if p_user_id is not null and p_user_id <> v_user_id then
    raise exception 'today_v2_seed_default_habits_for_user can only seed auth.uid()';
  end if;

  insert into public.today_v2_habit_definitions (
    user_id,
    seed_key,
    name,
    response_type,
    unit,
    schedule_weekdays,
    display_order,
    is_archived,
    archived_at
  )
  values
    (v_user_id, 'sleep', 'Sleep', 'number', 'hours', array[0,1,2,3,4,5,6]::smallint[], 0, false, null),
    (v_user_id, 'exercise_movement', 'Exercise/movement', 'boolean', null, array[0,1,2,3,4,5,6]::smallint[], 1, false, null),
    (v_user_id, 'focused_work', 'Focused work', 'number', 'minutes', array[0,1,2,3,4,5,6]::smallint[], 2, false, null)
  on conflict do nothing;
end;
$$;

grant execute on function public.today_v2_seed_default_habits_for_user(uuid) to authenticated;

create or replace function public.today_v2_ensure_habit_occurrences_for_date(
  p_local_date date,
  p_timezone_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_weekday smallint;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return;
  end if;

  v_weekday := extract(dow from p_local_date)::smallint;

  insert into public.today_v2_habit_occurrences (
    user_id,
    habit_definition_id,
    local_date,
    timezone_name,
    scheduled_weekday,
    snapshot_name,
    snapshot_response_type,
    snapshot_unit,
    snapshot_display_order
  )
  select
    habit_definition.user_id,
    habit_definition.id,
    p_local_date,
    p_timezone_name,
    v_weekday,
    habit_definition.name,
    habit_definition.response_type,
    habit_definition.unit,
    habit_definition.display_order
  from public.today_v2_habit_definitions habit_definition
  where habit_definition.user_id = v_user_id
    and habit_definition.is_archived = false
    and habit_definition.schedule_weekdays @> array[v_weekday]::smallint[]
  on conflict (user_id, habit_definition_id, local_date) do nothing;
end;
$$;

grant execute on function public.today_v2_ensure_habit_occurrences_for_date(date, text) to authenticated;

create or replace function public.today_v2_replace_plan_for_date(
  p_target_local_date date,
  p_source_local_date date,
  p_timezone_name text,
  p_raw_plan_text text,
  p_fragment_texts text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_plan_input_id uuid;
  v_has_answered_fragments boolean;
  v_trimmed_text text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return;
  end if;

  select exists(
    select 1
    from public.today_v2_commitment_fragments fragment
    where fragment.user_id = v_user_id
      and fragment.target_local_date = p_target_local_date
      and fragment.completion_state <> 'unanswered'
  ) into v_has_answered_fragments;

  if v_has_answered_fragments then
    raise exception 'today_v2_replace_plan_for_date cannot overwrite answered fragments';
  end if;

  v_trimmed_text := trim(coalesce(p_raw_plan_text, ''));

  if v_trimmed_text = '' and coalesce(array_length(p_fragment_texts, 1), 0) = 0 then
    delete from public.today_v2_commitment_fragments
    where user_id = v_user_id
      and target_local_date = p_target_local_date
      and completion_state = 'unanswered';

    delete from public.today_v2_plan_inputs
    where user_id = v_user_id
      and target_local_date = p_target_local_date;

    return;
  end if;

  insert into public.today_v2_plan_inputs (
    user_id,
    source_local_date,
    target_local_date,
    timezone_name,
    raw_plan_text,
    parser_version
  ) values (
    v_user_id,
    p_source_local_date,
    p_target_local_date,
    p_timezone_name,
    coalesce(p_raw_plan_text, ''),
    'commitment-fragmentation-v2'
  )
  on conflict (user_id, target_local_date)
  do update set
    source_local_date = excluded.source_local_date,
    timezone_name = excluded.timezone_name,
    raw_plan_text = excluded.raw_plan_text,
    parser_version = excluded.parser_version,
    updated_at = now()
  returning id into v_plan_input_id;

  delete from public.today_v2_commitment_fragments
  where user_id = v_user_id
    and target_local_date = p_target_local_date
    and completion_state = 'unanswered';

  insert into public.today_v2_commitment_fragments (
    plan_input_id,
    user_id,
    source_local_date,
    target_local_date,
    timezone_name,
    fragment_order,
    fragment_text,
    normalized_fragment_text,
    parser_version,
    completion_state
  )
  select
    v_plan_input_id,
    v_user_id,
    p_source_local_date,
    p_target_local_date,
    p_timezone_name,
    fragment_input.idx - 1,
    trim(fragment_input.fragment_text),
    regexp_replace(trim(fragment_input.fragment_text), '\s+', ' ', 'g'),
    'commitment-fragmentation-v2',
    'unanswered'
  from unnest(coalesce(p_fragment_texts, array[]::text[])) with ordinality as fragment_input(fragment_text, idx)
  where trim(fragment_input.fragment_text) <> '';
end;
$$;

grant execute on function public.today_v2_replace_plan_for_date(date, date, text, text, text[]) to authenticated;

notify pgrst, 'reload schema';

alter table public.today_v2_daily_reviews
  add column if not exists controllable_focus text;

alter table public.today_v2_plan_inputs
  add column if not exists first_five_minutes text;

create or replace function public.today_v2_replace_plan_for_date(
  p_target_local_date date,
  p_source_local_date date,
  p_timezone_name text,
  p_raw_plan_text text,
  p_fragment_texts text[],
  p_first_five_minutes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_plan_input_id uuid;
  v_has_answered_fragments boolean;
  v_trimmed_text text;
  v_trimmed_first_five_minutes text;
  v_keep_orders integer[];
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return;
  end if;

  select exists(
    select 1
    from public.today_v2_commitment_fragments fragment
    where fragment.user_id = v_user_id
      and fragment.target_local_date = p_target_local_date
      and fragment.completion_state <> 'unanswered'
  ) into v_has_answered_fragments;

  if v_has_answered_fragments then
    raise exception 'today_v2_replace_plan_for_date cannot overwrite answered fragments';
  end if;

  v_trimmed_text := trim(coalesce(p_raw_plan_text, ''));
  v_trimmed_first_five_minutes := trim(coalesce(p_first_five_minutes, ''));

  if v_trimmed_text = ''
    and coalesce(array_length(p_fragment_texts, 1), 0) = 0
    and v_trimmed_first_five_minutes = '' then
    delete from public.today_v2_commitment_fragments
    where user_id = v_user_id
      and target_local_date = p_target_local_date
      and completion_state = 'unanswered';

    delete from public.today_v2_plan_inputs
    where user_id = v_user_id
      and target_local_date = p_target_local_date;

    return;
  end if;

  insert into public.today_v2_plan_inputs (
    user_id,
    source_local_date,
    target_local_date,
    timezone_name,
    raw_plan_text,
    parser_version,
    first_five_minutes
  ) values (
    v_user_id,
    p_source_local_date,
    p_target_local_date,
    p_timezone_name,
    coalesce(p_raw_plan_text, ''),
    'commitment-fragmentation-v2',
    nullif(v_trimmed_first_five_minutes, '')
  )
  on conflict (user_id, target_local_date)
  do update set
    source_local_date = excluded.source_local_date,
    timezone_name = excluded.timezone_name,
    raw_plan_text = excluded.raw_plan_text,
    parser_version = excluded.parser_version,
    first_five_minutes = excluded.first_five_minutes,
    updated_at = now()
  returning id into v_plan_input_id;

  select coalesce(array_agg((fragment_input.idx - 1)::integer), array[]::integer[])
  into v_keep_orders
  from unnest(coalesce(p_fragment_texts, array[]::text[])) with ordinality as fragment_input(fragment_text, idx)
  where trim(fragment_input.fragment_text) <> '';

  insert into public.today_v2_commitment_fragments (
    plan_input_id,
    user_id,
    source_local_date,
    target_local_date,
    timezone_name,
    fragment_order,
    fragment_text,
    normalized_fragment_text,
    parser_version,
    completion_state
  )
  select
    v_plan_input_id,
    v_user_id,
    p_source_local_date,
    p_target_local_date,
    p_timezone_name,
    fragment_input.idx - 1,
    trim(fragment_input.fragment_text),
    regexp_replace(trim(fragment_input.fragment_text), '\s+', ' ', 'g'),
    'commitment-fragmentation-v2',
    'unanswered'
  from unnest(coalesce(p_fragment_texts, array[]::text[])) with ordinality as fragment_input(fragment_text, idx)
  where trim(fragment_input.fragment_text) <> ''
  on conflict (user_id, target_local_date, fragment_order)
  do update set
    plan_input_id = excluded.plan_input_id,
    source_local_date = excluded.source_local_date,
    timezone_name = excluded.timezone_name,
    fragment_text = excluded.fragment_text,
    normalized_fragment_text = excluded.normalized_fragment_text,
    parser_version = excluded.parser_version,
    updated_at = now();

  delete from public.today_v2_commitment_fragments
  where user_id = v_user_id
    and target_local_date = p_target_local_date
    and completion_state = 'unanswered'
    and not (fragment_order = any(v_keep_orders));
end;
$$;

grant execute on function public.today_v2_replace_plan_for_date(date, date, text, text, text[], text) to authenticated;

notify pgrst, 'reload schema';

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

create or replace function public.today_v2_finish_google_authorization(
  p_state_hash text, p_tokens_encrypted text, p_selected_calendar_ids text[]
)
returns setof public.today_v2_google_connections
language sql security definer set search_path = public as $$
  with consumed_state as (
    delete from public.today_v2_google_oauth_states
    where state_hash = p_state_hash and expires_at > now()
    returning user_id
  )
  insert into public.today_v2_google_connections(user_id, tokens_encrypted, selected_calendar_ids)
  select user_id, p_tokens_encrypted, coalesce(p_selected_calendar_ids, '{}'::text[])
  from consumed_state
  on conflict (user_id) do update set
    tokens_encrypted = excluded.tokens_encrypted,
    selected_calendar_ids = excluded.selected_calendar_ids,
    updated_at = now()
  returning *;
$$;
revoke all on function public.today_v2_finish_google_authorization(text, text, text[]) from public, anon, authenticated;
grant execute on function public.today_v2_finish_google_authorization(text, text, text[]) to service_role;

revoke all on function public.today_v2_validate_schedule_block() from public, anon, authenticated;
revoke all on function public.today_v2_archive_habit_schedule() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Repair only: retain the original workflow and scheduling migration history.
-- Apply transactionally: Supabase migration runner, or psql --single-transaction.
alter table public.today_v2_schedule_blocks add column if not exists source_review_id uuid;
create unique index if not exists idx_today_v2_reviews_owner_id
  on public.today_v2_daily_reviews(user_id, id);

insert into public.today_v2_daily_reviews(user_id, local_date, timezone_name)
select distinct b.user_id, coalesce(f.source_local_date, b.target_local_date - 1), b.timezone_name
from public.today_v2_schedule_blocks b
left join public.today_v2_commitment_fragments f on f.id = b.commitment_fragment_id
on conflict (user_id, local_date) do nothing;
-- Backfill provenance without revalidating historical habit definitions or changing
-- their schedule timestamps. Trigger changes and the update roll back together.
do $$
begin
  alter table public.today_v2_schedule_blocks disable trigger today_v2_schedule_validate;
  alter table public.today_v2_schedule_blocks disable trigger today_v2_schedule_set_updated_at;
  update public.today_v2_schedule_blocks b set source_review_id = r.id
  from public.today_v2_daily_reviews r
  where r.user_id = b.user_id
    and r.local_date = coalesce(
      (select f.source_local_date from public.today_v2_commitment_fragments f where f.id = b.commitment_fragment_id),
      b.target_local_date - 1)
    and b.source_review_id is null;
  alter table public.today_v2_schedule_blocks enable trigger today_v2_schedule_validate;
  alter table public.today_v2_schedule_blocks enable trigger today_v2_schedule_set_updated_at;
end;
$$;
alter table public.today_v2_schedule_blocks alter column source_review_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'today_v2_schedule_review_owner_fk'
    and conrelid = 'public.today_v2_schedule_blocks'::regclass) then
    alter table public.today_v2_schedule_blocks add constraint today_v2_schedule_review_owner_fk
      foreign key (user_id, source_review_id) references public.today_v2_daily_reviews(user_id, id);
  end if;
end;
$$;

-- Every writer locks the same review row that completion/reopen updates.
create or replace function public.today_v2_lock_source_review(p_user_id uuid, p_local_date date, p_timezone_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_review public.today_v2_daily_reviews;
begin
  insert into public.today_v2_daily_reviews(user_id, local_date, timezone_name)
  values(p_user_id, p_local_date, p_timezone_name)
  on conflict (user_id, local_date) do nothing;
  select * into strict v_review from public.today_v2_daily_reviews
  where user_id = p_user_id and local_date = p_local_date for update;
  if v_review.completed_at is not null then
    raise exception 'Source review is completed; reopen it before editing';
  end if;
  return v_review.id;
end;
$$;

create or replace function public.today_v2_guard_schedule_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_date date; v_review_id uuid;
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
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
  v_review_id := public.today_v2_lock_source_review(new.user_id, v_date, new.timezone_name);
  if new.source_review_id is not null and new.source_review_id <> v_review_id then
    raise exception 'Schedule source review must match its owned source';
  end if;
  new.source_review_id := v_review_id;
  return new;
end;
$$;
drop trigger if exists today_v2_schedule_review_lock on public.today_v2_schedule_blocks;
create trigger today_v2_schedule_review_lock before insert or update or delete on public.today_v2_schedule_blocks
for each row execute function public.today_v2_guard_schedule_review();

create or replace function public.today_v2_guard_plan_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  -- Answering tomorrow's checklist does not mutate yesterday's plan.
  if tg_table_name = 'today_v2_commitment_fragments' and tg_op = 'UPDATE'
    and (to_jsonb(new) - array['completion_state','answered_at','updated_at'])
      = (to_jsonb(old) - array['completion_state','answered_at','updated_at']) then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    perform public.today_v2_lock_source_review(old.user_id, old.source_local_date, old.timezone_name);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  perform public.today_v2_lock_source_review(new.user_id, new.source_local_date, new.timezone_name);
  return new;
end;
$$;
drop trigger if exists today_v2_plan_review_lock on public.today_v2_plan_inputs;
create trigger today_v2_plan_review_lock before insert or update or delete on public.today_v2_plan_inputs
for each row execute function public.today_v2_guard_plan_review();
drop trigger if exists today_v2_fragment_review_lock on public.today_v2_commitment_fragments;
create trigger today_v2_fragment_review_lock before insert or update or delete on public.today_v2_commitment_fragments
for each row execute function public.today_v2_guard_plan_review();

-- Preserve the stable implementation, but acquire review locks before target locks.
do $$
begin
  if to_regprocedure('public.today_v2_replace_plan_stable_unlocked(date,date,text,text,text[],uuid[],text)') is null then
    alter function public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text)
      rename to today_v2_replace_plan_stable_unlocked;
  end if;
end;
$$;
create or replace function public.today_v2_replace_plan_stable(
  p_target_local_date date, p_source_local_date date, p_timezone_name text,
  p_raw_plan_text text, p_fragment_texts text[], p_fragment_ids uuid[], p_first_five_minutes text default null
)
returns setof public.today_v2_commitment_fragments
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.today_v2_lock_source_review(auth.uid(), p_source_local_date, p_timezone_name);
  return query select * from public.today_v2_replace_plan_stable_unlocked(
    p_target_local_date, p_source_local_date, p_timezone_name, p_raw_plan_text,
    p_fragment_texts, p_fragment_ids, p_first_five_minutes);
end;
$$;

create or replace function public.today_v2_replace_plan_for_date(
  p_target_local_date date, p_source_local_date date, p_timezone_name text,
  p_raw_plan_text text, p_fragment_texts text[], p_first_five_minutes text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_texts text[]; v_ids uuid[];
begin
  if auth.uid() is null then return; end if;
  perform public.today_v2_lock_source_review(auth.uid(), p_source_local_date, p_timezone_name);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_target_local_date::text, 0));
  delete from public.today_v2_schedule_blocks b using public.today_v2_commitment_fragments f
  where b.commitment_fragment_id = f.id and f.user_id = auth.uid() and f.target_local_date = p_target_local_date
    and not exists (
      select 1 from unnest(p_fragment_texts) with ordinality x(t, ord)
      where ord - 1 = f.fragment_order and trim(t) = f.fragment_text
    );
  select coalesce(array_agg(trim(x.t) order by x.ord), '{}'::text[]),
    coalesce(array_agg(f.id order by x.ord), '{}'::uuid[]) into v_texts, v_ids
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
declare v_user_id uuid := auth.uid();
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
  -- Lock even an empty replacement or a habit-only plan with no existing blocks.
  perform public.today_v2_lock_source_review(v_user_id, p_target_local_date - 1, p_timezone_name);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_target_local_date::text, 0));
  delete from public.today_v2_schedule_blocks where user_id = v_user_id and target_local_date = p_target_local_date;
  insert into public.today_v2_schedule_blocks(
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

create or replace function public.today_v2_archive_habit_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_archived and not old.is_archived then
    delete from public.today_v2_schedule_blocks b
    where b.user_id = new.user_id and b.habit_definition_id = new.id and b.starts_at >= now()
      and not exists (select 1 from public.today_v2_daily_reviews r
        where r.id = b.source_review_id and r.completed_at is not null)
      and not exists (select 1 from public.today_v2_daily_reviews r
        where r.user_id = b.user_id and r.local_date = b.target_local_date and r.completed_at is not null);
  end if;
  return new;
end;
$$;

revoke all on function public.today_v2_lock_source_review(uuid, date, text) from public, anon, authenticated;
revoke all on function public.today_v2_guard_schedule_review() from public, anon, authenticated;
revoke all on function public.today_v2_guard_plan_review() from public, anon, authenticated;
revoke all on function public.today_v2_replace_plan_stable_unlocked(date,date,text,text,text[],uuid[],text) from public, anon, authenticated;
revoke all on function public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text) from public, anon;
grant execute on function public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text) to authenticated;
notify pgrst, 'reload schema';
