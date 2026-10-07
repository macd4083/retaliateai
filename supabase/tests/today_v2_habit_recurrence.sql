-- psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_habit_recurrence.sql
-- Requires all Today V2 migrations through 20261010.
begin;
\ir ../migrations/20261010_today_v2_habit_recurrence.sql
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000091'),
  ('00000000-0000-4000-8000-000000000092');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);

do $$
declare v_habit uuid; v_manual uuid; v_id uuid; v_failure boolean := false;
begin
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Precise recurrence','boolean',array[2]::smallint[],'automatic',
    '{"2":{"time":"09:07","duration_minutes":43,"occurrence":"earlier"}}') returning id into v_habit;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,schedule_times)
  values(auth.uid(),'Manual preference','boolean',array[2]::smallint[],
    '{"2":{"time":"11:03","duration_minutes":19,"occurrence":"earlier"}}') returning id into v_manual;
  perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  select id into strict v_id from public.today_v2_schedule_blocks where habit_definition_id = v_habit;
  assert (select starts_at = '2026-09-29T09:07:00Z' and ends_at = '2026-09-29T09:50:00Z'
    and is_automatic from public.today_v2_schedule_blocks where id = v_id), 'Minute precision and elapsed duration';
  assert not exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_manual),
    'Manual habits are not booked automatically';
  perform public.today_v2_replace_schedule('2026-09-29','UTC',jsonb_build_array(jsonb_build_object(
    'habit_definition_id',v_habit,'starts_at','2026-09-29T09:07:00Z','ends_at','2026-09-29T09:50:00Z')));
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_id and is_automatic),
    'Saving an unchanged generated block preserves UUID and automatic provenance';
  assert not exists(select 1 from public.today_v2_habit_schedule_overrides where habit_definition_id = v_habit),
    'Saving unchanged times does not create a manual override';
  perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  assert (select count(*) = 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit),
    'Idempotent seed';
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_id), 'Stable automatic UUID';
  update public.today_v2_habit_definitions set schedule_times =
    '{"2":{"time":"09:11","duration_minutes":31,"occurrence":"earlier"}}' where id = v_habit;
  perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_id and starts_at = '2026-09-29T09:11:00Z'),
    'Definition edit reconciles generated times without replacing identity';
  perform public.today_v2_replace_schedule('2026-09-29','UTC',jsonb_build_array(jsonb_build_object(
    'habit_definition_id',v_habit,'starts_at','2026-09-29T12:13:00Z','ends_at','2026-09-29T12:41:00Z')));
  update public.today_v2_habit_definitions set schedule_times =
    '{"2":{"time":"08:01","duration_minutes":30,"occurrence":"later"}}' where id = v_habit;
  perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_id
    and starts_at = '2026-09-29T12:13:00Z' and not is_automatic), 'Manual overrides survive edits/reload';
  perform public.today_v2_replace_schedule('2026-09-29','UTC','[]');
  perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  assert not exists(select 1 from public.today_v2_schedule_blocks where target_local_date = '2026-09-29'),
    'Unscheduling is persistent and never regenerated';
  update public.today_v2_daily_reviews set completed_at = now()
    where user_id = auth.uid() and local_date = '2026-09-28';
  perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  assert not exists(select 1 from public.today_v2_schedule_blocks where target_local_date = '2026-09-29'),
    'The seed-only completion exception still honors unscheduling tombstones';
  perform public.today_v2_seed_habit_schedules('2026-09-22','2026-09-22','UTC');
  perform public.today_v2_replace_schedule('2026-09-22','UTC','[]');
  perform public.today_v2_seed_habit_schedules('2026-09-22','2026-09-22','UTC');
  assert not exists(select 1 from public.today_v2_schedule_blocks where target_local_date = '2026-09-22'),
    'Removing a generated block directly creates a persistent suppression';
  perform public.today_v2_seed_habit_schedules('2026-10-06','2026-10-06','UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit
    and target_local_date = '2026-10-06'), 'An override only applies to its own date';
  update public.today_v2_daily_reviews set completed_at = now()
    where user_id = auth.uid() and local_date = '2026-10-05';
  update public.today_v2_habit_definitions set schedule_times =
    '{"2":{"time":"17:02","duration_minutes":60,"occurrence":"earlier"}}' where id = v_habit;
  perform public.today_v2_seed_habit_schedules('2026-10-06','2026-10-06','America/New_York');
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit
    and target_local_date = '2026-10-06' and starts_at = '2026-10-06T08:01:00Z' and timezone_name = 'UTC'),
    'Completed source review preserves recurrence evidence across edits/timezones';
  perform public.today_v2_seed_habit_schedules('2026-10-13','2026-10-13','UTC');
  update public.today_v2_daily_reviews set completed_at = now()
    where user_id = auth.uid() and local_date = '2026-10-13';
  update public.today_v2_habit_definitions set planning_mode = 'manual' where id = v_habit;
  perform public.today_v2_seed_habit_schedules('2026-10-13','2026-10-13','UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit
    and target_local_date = '2026-10-13'), 'Completed target evidence remains untouched';
  perform public.today_v2_seed_habit_schedules('2026-10-20','2026-10-20','UTC');
  assert not exists(select 1 from public.today_v2_schedule_blocks where target_local_date = '2026-10-20'),
    'Changed manual mode prevents future generation';
  begin
    update public.today_v2_habit_definitions set schedule_times =
      '{"2":{"time":"09:01","duration_minutes":1.5,"occurrence":"earlier"}}' where id = v_habit;
  exception when check_violation then v_failure := true; end;
  assert v_failure, 'Server rejects fractional durations';
end;
$$;

do $$
declare v_habit uuid; v_block uuid; v_source uuid; v_failed boolean := false;
begin
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Unvisited future recurrence','boolean',array[2]::smallint[],'automatic',
    '{"2":{"time":"09:07","duration_minutes":43,"occurrence":"earlier"}}') returning id into v_habit;
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name,desired_direction,completed_at)
  values(auth.uid(),'2026-11-02','UTC','Preserve completed identity',now()) returning id into v_source;
  -- Home can materialize this date without visiting yesterday's manual plan.
  perform public.today_v2_seed_habit_schedules('2026-11-03','2026-11-03','UTC');
  select id into strict v_block from public.today_v2_schedule_blocks
    where habit_definition_id = v_habit and target_local_date = '2026-11-03';
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_block
    and source_review_id = v_source and starts_at = '2026-11-03T09:07:00Z' and is_automatic),
    'An unmaterialized future habit is seeded even after the previous review completed';
  assert exists(select 1 from public.today_v2_daily_reviews where id = v_source
    and completed_at is not null and desired_direction = 'Preserve completed identity' and timezone_name = 'UTC'),
    'Seed-only insertion does not rewrite the completed source review';
  update public.today_v2_habit_definitions set schedule_times =
    '{"2":{"time":"10:11","duration_minutes":60,"occurrence":"later"}}' where id = v_habit;
  perform public.today_v2_seed_habit_schedules('2026-11-03','2026-11-03','America/New_York');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_block
    and starts_at = '2026-11-03T09:07:00Z' and ends_at = '2026-11-03T09:50:00Z' and timezone_name = 'UTC'),
    'Existing completed-source evidence is not changed by seeding';
  begin perform public.today_v2_replace_schedule('2026-11-03','UTC','[]');
  exception when others then v_failed := true; end;
  assert v_failed, 'Seed-only completion exception never unlocks the manual writer';
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name,completed_at)
  values(auth.uid(),'2026-11-10','UTC',now());
  perform public.today_v2_seed_habit_schedules('2026-11-10','2026-11-10','UTC');
  assert not exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit
    and target_local_date = '2026-11-10'), 'A completed target day still cannot receive new rows';
  perform public.today_v2_seed_habit_schedules('2026-11-17','2026-11-17','UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit
    and target_local_date = '2026-11-17'), 'Future Home recurrence does not require prior workflow visitation';
end;
$$;

do $$
declare v_early uuid; v_late uuid; v_gap uuid; v_valid uuid; v_samoa uuid;
begin
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Fold earlier','boolean',array[0]::smallint[],'automatic',
    '{"0":{"time":"01:37","duration_minutes":30,"occurrence":"earlier"}}') returning id into v_early;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Fold later','boolean',array[0]::smallint[],'automatic',
    '{"0":{"time":"01:37","duration_minutes":30,"occurrence":"later"}}') returning id into v_late;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Gap habit','boolean',array[0]::smallint[],'automatic',
    '{"0":{"time":"02:17","duration_minutes":30,"occurrence":"earlier"}}') returning id into v_gap;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Valid after gap','boolean',array[0]::smallint[],'automatic',
    '{"0":{"time":"03:07","duration_minutes":1440,"occurrence":"earlier"}}') returning id into v_valid;
  perform public.today_v2_seed_habit_schedules('2026-11-01','2026-11-01','America/New_York');
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_early
    and starts_at = '2026-11-01T05:37:00Z'), 'Earlier fold occurrence';
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_late
    and starts_at = '2026-11-01T06:37:00Z'), 'Later fold occurrence';
  perform public.today_v2_seed_habit_schedules('2026-03-08','2026-03-08','America/New_York');
  assert not exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_gap
    and target_local_date = '2026-03-08'), 'Skip nonexistent DST time, without aborting other habits';
  assert exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_valid
    and target_local_date = '2026-03-08' and starts_at = '2026-03-08T07:07:00Z'
    and ends_at - starts_at = interval '24 hours'), 'Valid habit survives gap and duration is elapsed time';
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Skipped date','boolean',array[5]::smallint[],'automatic',
    '{"5":{"time":"12:00","duration_minutes":30,"occurrence":"earlier"}}') returning id into v_samoa;
  perform public.today_v2_seed_habit_schedules('2011-12-30','2011-12-30','Pacific/Apia');
  assert not exists(select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_samoa),
    'An entirely skipped civil date is also safe';
end;
$$;

select set_config('test.foreign_habit_id',(select id::text from public.today_v2_habit_definitions
  where user_id = auth.uid() and name = 'Precise recurrence'),true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
set local role authenticated;
select public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
do $$
declare v_failed boolean := false;
begin
  assert not exists(select 1 from public.today_v2_schedule_blocks), 'Seeding and RLS are scoped to auth.uid()';
  assert not has_table_privilege('authenticated','public.today_v2_habit_schedule_overrides','INSERT'),
    'Overrides are writable only through authorized RPCs';
  assert not has_function_privilege('authenticated','public.today_v2_guard_schedule_review()','EXECUTE'),
    'The seed-only review guard remains private';
  begin
    perform public.today_v2_replace_schedule('2026-09-29','UTC',jsonb_build_array(jsonb_build_object(
      'habit_definition_id',current_setting('test.foreign_habit_id'),
      'starts_at','2026-09-29T09:07:00Z','ends_at','2026-09-29T09:50:00Z')));
  exception when others then v_failed := true; end;
  assert v_failed, 'The schedule RPC rejects another owner habit identity';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$
declare v_failed boolean := false;
begin
  begin perform public.today_v2_seed_habit_schedules('2026-09-29','2026-09-29','UTC');
  exception when others then v_failed := true; end;
  assert v_failed, 'Anonymous recurrence seeding is rejected';
end;
$$;
rollback;
