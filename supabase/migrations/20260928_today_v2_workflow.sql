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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_v2_daily_reviews_user_date_unique unique (user_id, local_date),
  constraint today_v2_daily_reviews_timezone_check check (char_length(trim(timezone_name)) > 0)
);

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
