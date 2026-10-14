-- psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_midnight_plan_dates.sql
-- Requires Today V2 migrations through 20261011_today_v2_day_schedule.sql.
-- Installs operational helpers only; every fixture/data change is rolled back.
\ir ../repairs/today_v2_midnight_plan_dates.sql
\ir ../repairs/today_v2_midnight_plan_dates.sql
begin;
set local timezone = 'UTC';
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000391');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000391', true);

create function pg_temp.expect_repair_failure(p_sql text) returns void language plpgsql as $$
declare v_failed boolean := false;
begin
  begin execute p_sql; exception when others then v_failed := true; end;
  assert v_failed, 'Expected rejection: ' || p_sql;
end;
$$;

-- Full-record insertion provides historical created_at without bypassing triggers.
create function pg_temp.midnight_plan(p_source date, p_zone text default 'UTC', p_hour integer default 1)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.today_v2_plan_inputs(
    user_id, source_local_date, target_local_date, timezone_name, raw_plan_text,
    first_five_minutes, parser_version, created_at, updated_at)
  values(auth.uid(), p_source, p_source + 1, p_zone, 'Keep exact plan content',
    'Keep first five', 'historical-parser', (p_source + make_time(p_hour, 0, 0)) at time zone p_zone,
    (p_source + make_time(p_hour, 0, 0)) at time zone p_zone) returning id into v_id;
  insert into public.today_v2_commitment_fragments(
    plan_input_id, user_id, source_local_date, target_local_date, timezone_name,
    fragment_order, fragment_text, normalized_fragment_text, parser_version, created_at, updated_at)
  values(v_id, auth.uid(), p_source, p_source + 1, p_zone, 0,
    'Keep exact fragment content', 'Keep exact normalized text', 'historical-parser',
    (p_source + make_time(p_hour, 0, 0)) at time zone p_zone,
    (p_source + make_time(p_hour, 0, 0)) at time zone p_zone);
  return v_id;
end;
$$;

do $$
declare
  v_id uuid; v_action uuid; v_habit uuid; v_before jsonb; v_after jsonb;
  v_batch uuid; v_result jsonb; v_other uuid; v_existing_review jsonb;
  v_cutoff timestamptz := '2026-10-01T00:00:00Z'; -- fixture cutoff, NOT a deployment claim
begin
  assert not has_schema_privilege('authenticated','today_v2_midnight_repair','usage');
  assert not has_schema_privilege('service_role','today_v2_midnight_repair','usage');
  perform pg_temp.expect_repair_failure($q$select today_v2_midnight_repair.apply(null, array[gen_random_uuid()], true)$q$);
  perform pg_temp.expect_repair_failure(format('select today_v2_midnight_repair.apply(%L, ''{}''::uuid[], true)', v_cutoff));

  -- Spring transition: moving March 9 -> March 8 preserves wall clock while
  -- changing the UTC offset. Action and cross-midnight automatic habit both move.
  v_id := pg_temp.midnight_plan('2026-03-08','America/New_York',0);
  select id into v_action from public.today_v2_commitment_fragments where plan_input_id = v_id;
  insert into public.today_v2_habit_definitions(user_id,name,response_type)
    values(auth.uid(),'Repair habit','boolean') returning id into v_habit;
  insert into public.today_v2_schedule_blocks(
    user_id,target_local_date,timezone_name,commitment_fragment_id,starts_at,ends_at,created_at,updated_at)
  values(auth.uid(),'2026-03-09','America/New_York',v_action,
    '2026-03-09T01:00:00-04:00','2026-03-09T01:30:00-04:00','2026-03-08T05:00:00Z','2026-03-08T05:00:00Z');
  insert into public.today_v2_schedule_blocks(
    user_id,target_local_date,timezone_name,habit_definition_id,starts_at,ends_at,is_automatic,created_at,updated_at)
  values(auth.uid(),'2026-03-09','America/New_York',v_habit,
    '2026-03-09T23:30:00-04:00','2026-03-10T00:30:00-04:00',true,'2026-03-08T05:00:00Z','2026-03-08T05:00:00Z');
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and skip_reasons = '{}'::text[] and action_schedule_count = 1 and habit_schedule_count = 1);
  v_before := today_v2_midnight_repair.snapshot(v_id);
  v_result := today_v2_midnight_repair.apply(v_cutoff,array[v_id]);
  assert (v_result->>'dry_run')::boolean;
  assert today_v2_midnight_repair.snapshot(v_id) = v_before, 'Default is read-only';
  assert not exists (select 1 from today_v2_midnight_repair.batches);
  assert (today_v2_midnight_repair.apply(v_cutoff,array[v_id],null)->>'dry_run')::boolean,
    'NULL execution flag must not authorize writes';
  v_result := today_v2_midnight_repair.apply(v_cutoff,array[v_id],true);
  v_batch := (v_result->>'batch_id')::uuid;
  v_after := today_v2_midnight_repair.snapshot(v_id);
  assert ((v_after->'input') - array['source_local_date','target_local_date'])
    = ((v_before->'input') - array['source_local_date','target_local_date']), 'Input metadata preserved';
  assert v_after->'input'->>'source_local_date' = '2026-03-07';
  assert v_after->'input'->>'target_local_date' = '2026-03-08';
  assert ((v_after->'fragments'->0) - array['source_local_date','target_local_date'])
    = ((v_before->'fragments'->0) - array['source_local_date','target_local_date']), 'Fragment metadata preserved';
  assert (select count(*) = 2 from public.today_v2_schedule_blocks b
    join public.today_v2_daily_reviews r on r.id = b.source_review_id
    where b.user_id = auth.uid() and b.target_local_date = '2026-03-08' and r.local_date = '2026-03-07');
  assert exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_action
    and starts_at = '2026-03-08T06:00:00Z' and ends_at = '2026-03-08T06:30:00Z'), 'Calendar shift not 24 elapsed hours';
  assert exists (select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit
    and target_local_date = '2026-03-08' and ends_at = '2026-03-09T04:30:00Z' and is_automatic);
  assert not exists (
    select 1 from jsonb_array_elements(v_before->'schedules') old_row
    join jsonb_array_elements(v_after->'schedules') new_row on old_row->>'id' = new_row->>'id'
    where old_row - array['target_local_date','source_review_id','starts_at','ends_at']
      <> new_row - array['target_local_date','source_review_id','starts_at','ends_at']),
    'Every schedule ID and all non-date metadata preserved';
  assert not exists (select 1 from today_v2_midnight_repair.report(v_cutoff) where plan_id = v_id), 'Idempotent detection';
  perform pg_temp.expect_repair_failure(format(
    'select today_v2_midnight_repair.apply(%L, array[%L]::uuid[], true)',v_cutoff,v_id));

  -- Live locks still enforce completion; neither repair nor rollback bypasses them.
  begin
    update public.today_v2_daily_reviews set completed_at = now()
      where user_id = auth.uid() and local_date = '2026-03-07';
    perform pg_temp.expect_repair_failure(format('delete from public.today_v2_schedule_blocks where commitment_fragment_id = %L',v_action));
    perform pg_temp.expect_repair_failure(format('select today_v2_midnight_repair.rollback(%L,true)',v_batch));
    raise exception using errcode = 'Z0001', message = 'Discard completed fixture';
  exception when sqlstate 'Z0001' then null; end;
  -- Guard against new destinations and content edits.
  begin
    v_other := pg_temp.midnight_plan('2026-03-08','America/New_York');
    perform pg_temp.expect_repair_failure(format('select today_v2_midnight_repair.rollback(%L,true)',v_batch));
    raise exception using errcode = 'Z0001', message = 'Discard destination fixture';
  exception when sqlstate 'Z0001' then null; end;
  begin
    update public.today_v2_plan_inputs set raw_plan_text = 'Later edit' where id = v_id;
    perform pg_temp.expect_repair_failure(format('select today_v2_midnight_repair.rollback(%L,true)',v_batch));
    raise exception using errcode = 'Z0001', message = 'Discard edited fixture';
  exception when sqlstate 'Z0001' then null; end;
  assert (today_v2_midnight_repair.rollback(v_batch)->>'rollback_safe')::boolean;
  assert (today_v2_midnight_repair.rollback(v_batch,null)->>'dry_run')::boolean;
  perform set_config('TimeZone','Asia/Tokyo',true);
  assert (today_v2_midnight_repair.rollback(v_batch)->>'rollback_safe')::boolean, 'Snapshots independent of session timezone';
  perform set_config('TimeZone','UTC',true);
  assert today_v2_midnight_repair.snapshot(v_id) = v_after, 'Rollback defaults to dry run';
  perform today_v2_midnight_repair.rollback(v_batch,true);
  assert today_v2_midnight_repair.snapshot(v_id) = v_before, 'Exact full-row rollback';
  assert not exists (select 1 from public.today_v2_daily_reviews
    where user_id = auth.uid() and local_date = '2026-03-07'), 'Only repair-created review removed';
  perform pg_temp.expect_repair_failure(format('select today_v2_midnight_repair.rollback(%L,true)',v_batch));

  -- Destination conflicts, answered fragment, completed and answered reviews.
  v_id := pg_temp.midnight_plan('2026-04-10');
  v_other := pg_temp.midnight_plan('2026-04-09');
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'occupied_destination' = any(skip_reasons));
  perform pg_temp.expect_repair_failure(format(
    'select today_v2_midnight_repair.apply(%L,array[%L]::uuid[],true)',v_cutoff,v_id));
  -- A mixed approved batch fails atomically, not by partially moving safe rows.
  v_other := pg_temp.midnight_plan('2026-04-15');
  v_before := today_v2_midnight_repair.snapshot(v_other);
  perform pg_temp.expect_repair_failure(format(
    'select today_v2_midnight_repair.apply(%L,array[%L,%L]::uuid[],true)',v_cutoff,v_id,v_other));
  assert today_v2_midnight_repair.snapshot(v_other) = v_before;
  v_id := pg_temp.midnight_plan('2026-04-20');
  update public.today_v2_commitment_fragments set completion_state = 'kept', answered_at = now()
    where plan_input_id = v_id;
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'answered_or_completed_evidence' = any(skip_reasons));
  v_id := pg_temp.midnight_plan('2026-04-25');
  update public.today_v2_daily_reviews set completed_at = now()
    where user_id = auth.uid() and local_date = '2026-04-25';
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'answered_or_completed_evidence' = any(skip_reasons));
  v_id := pg_temp.midnight_plan('2026-05-01');
  update public.today_v2_daily_reviews set desired_direction = 'Already answered'
    where user_id = auth.uid() and local_date = '2026-05-01';
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'answered_or_completed_evidence' = any(skip_reasons));

  v_id := pg_temp.midnight_plan('2026-05-10');
  update public.today_v2_commitment_fragments set timezone_name = 'Europe/London' where plan_input_id = v_id;
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'inconsistent_related_evidence' = any(skip_reasons));
  v_id := pg_temp.midnight_plan('2026-05-20');
  insert into public.today_v2_habit_schedule_overrides values(auth.uid(),'2026-05-21',v_habit);
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'habit_override_evidence' = any(skip_reasons));
  v_id := pg_temp.midnight_plan('2026-05-25');
  insert into public.today_v2_habit_occurrences(
    user_id,habit_definition_id,local_date,timezone_name,scheduled_weekday,
    snapshot_name,snapshot_response_type,boolean_response,answered_at)
  values(auth.uid(),v_habit,'2026-05-25','UTC',1,'Answered habit','boolean',true,now());
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'answered_or_completed_evidence' = any(skip_reasons));

  select id into v_id from public.today_v2_plan_inputs
    where user_id = auth.uid() and target_local_date = '2026-03-09';
  update public.today_v2_schedule_blocks
    set starts_at = '2026-03-09T02:30:00-04:00', ends_at = '2026-03-09T03:00:00-04:00'
    where commitment_fragment_id = v_action;
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'unsafe_schedule_shift' = any(skip_reasons)), 'DST gap reported and skipped';

  -- An existing blank review is reusable provenance, not a destination conflict.
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
    values(auth.uid(),'2026-06-29','UTC')
    returning to_jsonb(today_v2_daily_reviews.*) into v_existing_review;
  v_id := pg_temp.midnight_plan('2026-06-30');
  select id into v_action from public.today_v2_commitment_fragments where plan_input_id = v_id;
  insert into public.today_v2_schedule_blocks(
    user_id,target_local_date,timezone_name,commitment_fragment_id,starts_at,ends_at,created_at,updated_at)
  values(auth.uid(),'2026-07-01','UTC',v_action,
    '2026-07-01T10:00:00Z','2026-07-01T11:00:00Z','2026-06-30T01:00:00Z','2026-06-30T01:00:00Z');
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and skip_reasons = '{}'::text[]), 'Blank source review allowed';
  v_before := today_v2_midnight_repair.snapshot(v_id);
  v_batch := (today_v2_midnight_repair.apply(v_cutoff,array[v_id],true)->>'batch_id')::uuid;
  assert exists (select 1 from public.today_v2_schedule_blocks
    where commitment_fragment_id = v_action and source_review_id = (v_existing_review->>'id')::uuid),
    'Schedule provenance reuses existing review ID';
  assert exists (select 1 from today_v2_midnight_repair.backups
    where batch_id = v_batch and not review_created), 'Backup tracks reused review';
  perform today_v2_midnight_repair.rollback(v_batch,true);
  assert today_v2_midnight_repair.snapshot(v_id) = v_before;
  assert (select to_jsonb(r) from public.today_v2_daily_reviews r
    where id = (v_existing_review->>'id')::uuid) = v_existing_review,
    'Rollback preserves pre-existing review exactly';
  update public.today_v2_daily_reviews set desired_direction = 'Answered prior review'
    where id = (v_existing_review->>'id')::uuid;
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'answered_or_completed_evidence' = any(skip_reasons)
      and not 'occupied_destination' = any(skip_reasons)), 'Answered source is a separate skip reason';
  update public.today_v2_daily_reviews set desired_direction = null, completed_at = now()
    where id = (v_existing_review->>'id')::uuid;
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff)
    where plan_id = v_id and 'answered_or_completed_evidence' = any(skip_reasons)
      and not 'occupied_destination' = any(skip_reasons)), 'Completed source remains protected';

  -- Civil date differs from UTC date, and 04:00 is excluded.
  v_id := pg_temp.midnight_plan('2026-06-01','Asia/Tokyo',3);
  assert exists (select 1 from today_v2_midnight_repair.report(v_cutoff) where plan_id = v_id);
  v_id := pg_temp.midnight_plan('2026-06-05','Asia/Tokyo',4);
  assert not exists (select 1 from today_v2_midnight_repair.report(v_cutoff) where plan_id = v_id);
  v_id := pg_temp.midnight_plan('2026-10-02');
  assert not exists (select 1 from today_v2_midnight_repair.report(v_cutoff) where plan_id = v_id), 'Cutoff enforced';

  assert today_v2_midnight_repair.shift_time('2026-03-09T02:30:00-04:00','America/New_York') is null, 'DST gap skipped';
  assert today_v2_midnight_repair.shift_time('2026-11-02T01:30:00-05:00','America/New_York') is null, 'DST fold skipped';
  assert today_v2_midnight_repair.shift_time('2026-11-02T10:00:00-05:00','America/New_York')
    = '2026-11-01T10:00:00-05:00'::timestamptz, 'Fall calendar shift';
  assert not exists (select 1 from pg_trigger where tgrelid in (
    'public.today_v2_schedule_blocks'::regclass, 'public.today_v2_plan_inputs'::regclass,
    'public.today_v2_commitment_fragments'::regclass) and not tgisinternal and tgenabled <> 'O'),
    'Repair leaves all live protections enabled';
end;
$$;
rollback;
