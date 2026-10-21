-- MANUAL operator repair, NOT a deployment migration. Requires migrations through
-- 20261011_today_v2_day_schedule.sql. Run as the database owner, not an API role.
-- No live data has been inspected. Take a database backup before using this file.
--
-- Installing this file changes no workflow data. report() is a SELECT-only dry run.
-- Supply the verified UTC deployment cutoff for #374 yourself; there is deliberately
-- no default timestamp. created_at < cutoff is necessary, not sufficient evidence.
-- Review each row, including action AND habit counts, and explicitly approve IDs.
-- The old source is the creation civil date instead of the previous review day:
-- move source and target BACK one day, retaining target = source + 1. Existing
-- reviews/outcomes are not shifted. Empty, incomplete reviews with matching
-- timezones can be reused; rollback never deletes a pre-existing review.
-- The old source review (now the target review) must be blank and incomplete.
-- Historical habit recurrence metadata is retained; overrides/tombstones,
-- post-cutoff edits and unsupported next weekdays require separate manual review.
--
-- SELECT * FROM today_v2_midnight_repair.report(
--   'OPERATOR_VERIFIED_PRE_374_CUTOFF'::timestamptz);
-- BEGIN;
-- SELECT today_v2_midnight_repair.apply(
--   'OPERATOR_VERIFIED_PRE_374_CUTOFF'::timestamptz,
--   ARRAY['APPROVED_PLAN_UUID']::uuid[]); -- default dry run: no writes
-- ROLLBACK;
--
-- After independent review, execute the same call with a third argument true in
-- BEGIN/COMMIT. Save the returned batch UUID. Exceptions abort the entire batch.
-- This takes table write locks: use a maintenance window and bounded lock_timeout.
-- SQL Editor callers can use the same statements, without psql variables.
--
-- Executable rollback (also dry-run by default):
-- BEGIN;
-- SELECT today_v2_midnight_repair.rollback('SAVED_BATCH_UUID'::uuid);
-- ROLLBACK;
-- BEGIN;
-- SELECT today_v2_midnight_repair.rollback('SAVED_BATCH_UUID'::uuid, true);
-- COMMIT;
-- Rollback rejects subsequent edits, new destination rows, answers/completions,
-- or changed/referenced repair-created reviews. Never reopen reviews to force it.

begin;
create schema if not exists today_v2_midnight_repair;
revoke all on schema today_v2_midnight_repair from public, anon, authenticated, service_role;

create table if not exists today_v2_midnight_repair.batches (
  id uuid primary key default gen_random_uuid(),
  cutoff timestamptz not null,
  applied_at timestamptz not null default now(),
  rolled_back_at timestamptz
);
create table if not exists today_v2_midnight_repair.backups (
  batch_id uuid not null references today_v2_midnight_repair.batches(id),
  plan_id uuid not null,
  before_rows jsonb not null,
  after_rows jsonb not null,
  created_review jsonb not null,
  review_created boolean not null default true,
  primary key (batch_id, plan_id)
);
alter table today_v2_midnight_repair.backups
  add column if not exists review_created boolean not null default true;
alter table today_v2_midnight_repair.batches enable row level security;
alter table today_v2_midnight_repair.backups enable row level security;
revoke all on all tables in schema today_v2_midnight_repair from public, anon, authenticated, service_role;

-- Shift wall-clock endpoints, not elapsed UTC intervals. A nonexistent or
-- ambiguous destination endpoint is rejected instead of silently normalized.
create or replace function today_v2_midnight_repair.shift_time(p_time timestamptz, p_zone text)
returns timestamptz language plpgsql stable as $$
declare v_wall timestamp; v_result timestamptz;
begin
  if p_time is null or not isfinite(p_time)
    or not exists (select 1 from pg_timezone_names where name = p_zone) then return null; end if;
  v_wall := (p_time at time zone p_zone) - interval '1 day';
  with candidates as (
    select distinct (v_wall at time zone 'UTC') -
      ((sample at time zone p_zone) - (sample at time zone 'UTC')) as instant, t
    from (select v_wall as t) wall, lateral generate_series(
      (v_wall at time zone 'UTC') - interval '36 hours',
      (v_wall at time zone 'UTC') + interval '36 hours', interval '6 hours') sample
  )
  select case when count(*) = 1 then min(instant) end into v_result
  from candidates where instant at time zone p_zone = t;
  return v_result;
end;
$$;

create or replace function today_v2_midnight_repair.report(p_cutoff timestamptz)
returns table (
  plan_id uuid, user_id uuid, timezone_name text, created_local timestamp,
  old_source date, old_target date, new_source date, new_target date,
  fragment_count bigint, action_schedule_count bigint, habit_schedule_count bigint,
  skip_reasons text[]
) language sql stable as $$
  select p.id, p.user_id, p.timezone_name, p.created_at at time zone p.timezone_name,
    p.source_local_date, p.target_local_date, p.source_local_date - 1, p.target_local_date - 1,
    (select count(*) from public.today_v2_commitment_fragments f where f.plan_input_id = p.id),
    (select count(*) from public.today_v2_schedule_blocks b
      where b.user_id = p.user_id and b.target_local_date = p.target_local_date and b.commitment_fragment_id is not null),
    (select count(*) from public.today_v2_schedule_blocks b
      where b.user_id = p.user_id and b.target_local_date = p.target_local_date and b.habit_definition_id is not null),
    array_remove(array[
      case when p.updated_at >= p_cutoff then 'edited_after_cutoff' end,
      case when exists (
        select 1 from public.today_v2_plan_inputs q where q.user_id = p.user_id
          and q.id <> p.id and q.target_local_date = p.target_local_date - 1
        union all
        select 1 from public.today_v2_commitment_fragments f where f.user_id = p.user_id
          and f.target_local_date = p.target_local_date - 1
        union all
        select 1 from public.today_v2_schedule_blocks b where b.user_id = p.user_id
          and b.target_local_date = p.target_local_date - 1
      ) then 'occupied_destination' end,
      case when exists (
        select 1 from public.today_v2_commitment_fragments f
        where (f.plan_input_id = p.id or (f.user_id = p.user_id and f.target_local_date = p.target_local_date))
          and (f.plan_input_id is distinct from p.id or f.user_id <> p.user_id
            or f.source_local_date <> p.source_local_date or f.target_local_date <> p.target_local_date
            or f.timezone_name <> p.timezone_name or f.created_at >= p_cutoff or f.updated_at >= p_cutoff)
        union all
        select 1 from public.today_v2_schedule_blocks b
        left join public.today_v2_daily_reviews r on r.id = b.source_review_id
        where (b.user_id = p.user_id and b.target_local_date = p.target_local_date
          or b.commitment_fragment_id in (select id from public.today_v2_commitment_fragments where plan_input_id = p.id))
          and (b.user_id <> p.user_id or b.target_local_date <> p.target_local_date
            or b.timezone_name <> p.timezone_name or b.created_at >= p_cutoff or b.updated_at >= p_cutoff
            or r.user_id is distinct from p.user_id or r.local_date is distinct from p.source_local_date
            or b.commitment_fragment_id is not null and not exists (
              select 1 from public.today_v2_commitment_fragments f where f.id = b.commitment_fragment_id and f.plan_input_id = p.id))
        union all
        select 1 from public.today_v2_daily_reviews r where r.user_id = p.user_id
          and r.local_date between p.source_local_date - 1 and p.target_local_date
          and r.timezone_name <> p.timezone_name
      ) then 'inconsistent_related_evidence' end,
      case when exists (
        select 1 from public.today_v2_commitment_fragments f where f.user_id = p.user_id
          and f.target_local_date between p.source_local_date - 1 and p.target_local_date
          and (f.answered_at is not null or f.completion_state <> 'unanswered')
        union all
        select 1 from public.today_v2_habit_occurrences o where o.user_id = p.user_id
          and o.local_date between p.source_local_date - 1 and p.target_local_date
          and (o.answered_at is not null or o.boolean_response is not null or o.numeric_response is not null)
        union all
        select 1 from public.today_v2_daily_reviews r where r.user_id = p.user_id
          and r.local_date between p.source_local_date - 1 and p.target_local_date
          and (r.completed_at is not null or r.desired_direction is not null
            or r.controllable_focus is not null)
      ) then 'answered_or_completed_evidence' end,
      -- Overrides include unscheduled tombstones. Do not guess their provenance.
      case when exists (select 1 from public.today_v2_habit_schedule_overrides o
        where o.user_id = p.user_id and o.target_local_date in (p.target_local_date, p.target_local_date - 1))
        then 'habit_override_evidence' end,
      case when exists (
        select 1 from public.today_v2_schedule_blocks b
        left join public.today_v2_habit_definitions h on h.id = b.habit_definition_id
        where b.user_id = p.user_id and b.target_local_date = p.target_local_date
          and (today_v2_midnight_repair.shift_time(b.starts_at, b.timezone_name) is null
            or today_v2_midnight_repair.shift_time(b.ends_at, b.timezone_name) is null
            or (b.starts_at at time zone p.timezone_name)::date <> b.target_local_date
            or today_v2_midnight_repair.shift_time(b.ends_at, b.timezone_name)
              <= today_v2_midnight_repair.shift_time(b.starts_at, b.timezone_name)
            or today_v2_midnight_repair.shift_time(b.ends_at, b.timezone_name)
              - today_v2_midnight_repair.shift_time(b.starts_at, b.timezone_name) > interval '24 hours'
            or b.habit_definition_id is not null and (h.is_archived
              or not extract(dow from b.target_local_date - 1)::smallint = any(h.schedule_weekdays)))
      ) then 'unsafe_schedule_shift' end
    ]::text[], null)
  from public.today_v2_plan_inputs p
  join pg_timezone_names z on z.name = p.timezone_name
  where p_cutoff is not null and isfinite(p_cutoff) and p.created_at < p_cutoff
    and (p.created_at at time zone p.timezone_name)::time >= time '00:00'
    and (p.created_at at time zone p.timezone_name)::time < time '04:00'
    and p.source_local_date = (p.created_at at time zone p.timezone_name)::date
    and p.target_local_date = p.source_local_date + 1
$$;

create or replace function today_v2_midnight_repair.snapshot(p_plan uuid)
returns jsonb language sql stable set timezone = 'UTC' as $$
  select jsonb_build_object(
    'input', to_jsonb(p),
    'fragments', coalesce((select jsonb_agg(to_jsonb(f) order by f.id)
      from public.today_v2_commitment_fragments f where f.plan_input_id = p.id), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(to_jsonb(b) order by b.id)
      from public.today_v2_schedule_blocks b where b.user_id = p.user_id
        and b.target_local_date = p.target_local_date), '[]'::jsonb))
  from public.today_v2_plan_inputs p where p.id = p_plan
$$;

-- Serializes all evidence, including destination inserts and recurrence writers.
-- No trigger disabling, replication-role changes, or current-day capabilities.
create or replace function today_v2_midnight_repair.lock_tables()
returns void language plpgsql as $$
begin
  lock table public.today_v2_daily_reviews, public.today_v2_plan_inputs,
    public.today_v2_commitment_fragments, public.today_v2_schedule_blocks,
    public.today_v2_habit_definitions, public.today_v2_habit_occurrences,
    public.today_v2_habit_schedule_overrides,
    today_v2_midnight_repair.batches, today_v2_midnight_repair.backups
    in share row exclusive mode;
end;
$$;

-- Reinsert full records to preserve IDs, created_at, updated_at and all content.
-- Removing child schedules first handles the immediate composite fragment/date FK.
create or replace function today_v2_midnight_repair.restore_rows(p_plan uuid, p_rows jsonb)
returns void language plpgsql as $$
begin
  delete from public.today_v2_schedule_blocks where commitment_fragment_id in (
    select id from public.today_v2_commitment_fragments where plan_input_id = p_plan
  ) or (user_id, target_local_date) in (
    select user_id, target_local_date from public.today_v2_plan_inputs where id = p_plan
  );
  delete from public.today_v2_commitment_fragments where plan_input_id = p_plan;
  delete from public.today_v2_plan_inputs where id = p_plan;
  insert into public.today_v2_plan_inputs
    select * from jsonb_populate_record(null::public.today_v2_plan_inputs, p_rows->'input');
  insert into public.today_v2_commitment_fragments
    select * from jsonb_populate_recordset(null::public.today_v2_commitment_fragments, p_rows->'fragments');
  insert into public.today_v2_schedule_blocks
    select * from jsonb_populate_recordset(null::public.today_v2_schedule_blocks, p_rows->'schedules');
end;
$$;

create or replace function today_v2_midnight_repair.apply(
  p_cutoff timestamptz, p_approved_ids uuid[], p_execute boolean default false
) returns jsonb language plpgsql set timezone = 'UTC' as $$
declare
  v_report jsonb; v_batch uuid; v_id uuid; v_row record;
  v_before jsonb; v_shifted jsonb; v_review jsonb; v_review_created boolean;
begin
  if p_cutoff is null or not isfinite(p_cutoff) then
    raise exception 'Explicit verified pre-#374 deployment cutoff required';
  end if;
  if p_approved_ids is null or cardinality(p_approved_ids) = 0
    or exists (select 1 from unnest(p_approved_ids) i group by i having i is null or count(*) > 1) then
    raise exception 'Explicit nonempty, unique approved plan IDs required';
  end if;
  if p_execute is true then perform today_v2_midnight_repair.lock_tables(); end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.plan_id), '[]') into v_report
    from today_v2_midnight_repair.report(p_cutoff) r where r.plan_id = any(p_approved_ids);
  if p_execute is distinct from true then return jsonb_build_object('dry_run', true, 'report', v_report); end if;
  if jsonb_array_length(v_report) <> cardinality(p_approved_ids)
    or exists (select 1 from jsonb_array_elements(v_report) r where r->'skip_reasons' <> '[]'::jsonb) then
    raise exception 'Approved plans missing or unsafe; rerun SELECT report and review skip_reasons';
  end if;
  insert into today_v2_midnight_repair.batches(cutoff) values(p_cutoff) returning id into v_batch;
  for v_id in select i from unnest(p_approved_ids) i order by i loop
    select * into strict v_row from today_v2_midnight_repair.report(p_cutoff) where plan_id = v_id;
    if cardinality(v_row.skip_reasons) <> 0 then raise exception 'Plan became unsafe: %', v_id; end if;
    v_before := today_v2_midnight_repair.snapshot(v_id);
    select to_jsonb(r) into v_review from public.today_v2_daily_reviews r
      where r.user_id = v_row.user_id and r.local_date = v_row.new_source;
    v_review_created := not found;
    if v_review_created then
      insert into public.today_v2_daily_reviews(user_id, local_date, timezone_name)
        values(v_row.user_id, v_row.new_source, v_row.timezone_name)
        returning to_jsonb(today_v2_daily_reviews.*) into v_review;
    end if;
    select jsonb_build_object(
      'input', (v_before->'input') || jsonb_build_object(
        'source_local_date', v_row.new_source, 'target_local_date', v_row.new_target),
      'fragments', coalesce((select jsonb_agg(f || jsonb_build_object(
        'source_local_date', v_row.new_source, 'target_local_date', v_row.new_target))
        from jsonb_array_elements(v_before->'fragments') f), '[]'::jsonb),
      'schedules', coalesce((select jsonb_agg(b || jsonb_build_object(
        'target_local_date', v_row.new_target, 'source_review_id', v_review->>'id',
        'starts_at', today_v2_midnight_repair.shift_time((b->>'starts_at')::timestamptz, b->>'timezone_name'),
        'ends_at', today_v2_midnight_repair.shift_time((b->>'ends_at')::timestamptz, b->>'timezone_name')))
        from jsonb_array_elements(v_before->'schedules') b), '[]'::jsonb)) into v_shifted;
    perform today_v2_midnight_repair.restore_rows(v_id, v_shifted);
    insert into today_v2_midnight_repair.backups(
      batch_id, plan_id, before_rows, after_rows, created_review, review_created)
    values(v_batch, v_id, v_before, today_v2_midnight_repair.snapshot(v_id), v_review, v_review_created);
  end loop;
  return jsonb_build_object('dry_run', false, 'batch_id', v_batch, 'repaired', cardinality(p_approved_ids));
end;
$$;

create or replace function today_v2_midnight_repair.rollback(p_batch uuid, p_execute boolean default false)
returns jsonb language plpgsql set timezone = 'UTC' as $$
declare v_backup record; v_input public.today_v2_plan_inputs; v_review public.today_v2_daily_reviews;
begin
  perform today_v2_midnight_repair.lock_tables();
  if not exists (select 1 from today_v2_midnight_repair.batches where id = p_batch and rolled_back_at is null) then
    raise exception 'Unknown or already rolled-back batch';
  end if;
  for v_backup in select * from today_v2_midnight_repair.backups where batch_id = p_batch order by plan_id loop
    if today_v2_midnight_repair.snapshot(v_backup.plan_id) is distinct from v_backup.after_rows then
      raise exception 'Repaired rows have changed: %', v_backup.plan_id;
    end if;
    select * into v_input from jsonb_populate_record(null::public.today_v2_plan_inputs, v_backup.before_rows->'input');
    select * into v_review from jsonb_populate_record(null::public.today_v2_daily_reviews, v_backup.created_review);
    if (select to_jsonb(r) from public.today_v2_daily_reviews r where r.id = v_review.id)
      is distinct from v_backup.created_review then raise exception 'Repair source review changed'; end if;
    if exists (
      select 1 from public.today_v2_plan_inputs where user_id = v_input.user_id and target_local_date = v_input.target_local_date
      union all
      select 1 from public.today_v2_commitment_fragments where user_id = v_input.user_id and target_local_date = v_input.target_local_date
      union all
      select 1 from public.today_v2_schedule_blocks where user_id = v_input.user_id and target_local_date = v_input.target_local_date
      union all
      select 1 from public.today_v2_habit_schedule_overrides where user_id = v_input.user_id
        and target_local_date in (v_input.target_local_date, v_input.target_local_date - 1)
      union all
      select 1 from public.today_v2_daily_reviews where user_id = v_input.user_id
        and local_date between v_input.source_local_date - 1 and v_input.target_local_date
        and (completed_at is not null or desired_direction is not null or controllable_focus is not null
          or timezone_name <> v_input.timezone_name)
      union all
      select 1 from public.today_v2_habit_occurrences where user_id = v_input.user_id
        and local_date between v_input.source_local_date - 1 and v_input.target_local_date
        and (v_backup.review_created and local_date = v_review.local_date or answered_at is not null)
      union all
      select 1 from public.today_v2_commitment_fragments where user_id = v_input.user_id
        and (v_backup.review_created and source_local_date = v_review.local_date and plan_input_id is distinct from v_backup.plan_id
          or target_local_date between v_input.source_local_date - 1 and v_input.target_local_date and answered_at is not null)
      union all
      select 1 from public.today_v2_plan_inputs where user_id = v_input.user_id
        and v_backup.review_created and source_local_date = v_review.local_date and id <> v_backup.plan_id
      union all
      select 1 from public.today_v2_schedule_blocks where v_backup.review_created and source_review_id = v_review.id
        and id not in (select (b->>'id')::uuid from jsonb_array_elements(v_backup.after_rows->'schedules') b)
    ) then raise exception 'Rollback destination occupied or related evidence changed'; end if;
  end loop;
  if p_execute is distinct from true then return jsonb_build_object('dry_run', true, 'batch_id', p_batch, 'rollback_safe', true); end if;
  for v_backup in select * from today_v2_midnight_repair.backups where batch_id = p_batch order by plan_id loop
    perform today_v2_midnight_repair.restore_rows(v_backup.plan_id, v_backup.before_rows);
    if v_backup.review_created then
      delete from public.today_v2_daily_reviews where id = (v_backup.created_review->>'id')::uuid;
    end if;
  end loop;
  update today_v2_midnight_repair.batches set rolled_back_at = now() where id = p_batch;
  return jsonb_build_object('dry_run', false, 'batch_id', p_batch, 'rolled_back', true);
end;
$$;
revoke all on all functions in schema today_v2_midnight_repair from public, anon, authenticated, service_role;
commit;
