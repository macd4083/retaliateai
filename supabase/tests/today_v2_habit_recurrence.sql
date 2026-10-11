-- psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_habit_recurrence.sql
-- Requires all Today V2 migrations through 20261011.
begin;
\ir ../migrations/20261010_today_v2_habit_recurrence.sql
\ir ../migrations/20261011_today_v2_day_schedule.sql
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

-- Current-day timing edits do not reopen completed source reviews or replace
-- stale client snapshots of the rest of the day.
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000093'),
  ('00000000-0000-4000-8000-000000000094'),
  ('00000000-0000-4000-8000-000000000095');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000093',true);
do $$
declare
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
  v_habit uuid;
  v_manual uuid;
  v_action uuid;
  v_action_two uuid;
  v_block uuid;
  v_habit_block uuid;
  v_source uuid;
  v_before jsonb;
  v_other jsonb;
  v_failed boolean;
  v_times jsonb := '{}'::jsonb;
begin
  for d in 0..6 loop
    v_times := v_times || jsonb_build_object(d::text,
      jsonb_build_object('time','09:07','duration_minutes',43,'occurrence','earlier'));
  end loop;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays,planning_mode,schedule_times)
  values(auth.uid(),'Current automatic','boolean',array[0,1,2,3,4,5,6]::smallint[],'automatic',v_times)
  returning id into v_habit;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
  values(auth.uid(),'Current manual','boolean',array[0,1,2,3,4,5,6]::smallint[])
  returning id into v_manual;
  perform public.today_v2_replace_plan_stable(v_today,v_today-1,'UTC','Original plan',
    array['First action','Second action'],array[null,null]::uuid[],'Original first five');
  select id into strict v_action from public.today_v2_commitment_fragments
  where user_id = auth.uid() and target_local_date = v_today and fragment_order = 0;
  select id into strict v_action_two from public.today_v2_commitment_fragments
  where user_id = auth.uid() and target_local_date = v_today and fragment_order = 1;
  perform public.today_v2_seed_habit_schedules(v_today-1,v_today+1,'UTC');
  select id into strict v_habit_block from public.today_v2_schedule_blocks
  where user_id = auth.uid() and target_local_date = v_today and habit_definition_id = v_habit;
  perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action,
    (v_today + time '10:00') at time zone 'UTC',(v_today + time '10:30') at time zone 'UTC');
  select id into strict v_block from public.today_v2_schedule_blocks where commitment_fragment_id = v_action;
  update public.today_v2_commitment_fragments set completion_state = 'kept',answered_at = now()
  where id = v_action;
  update public.today_v2_daily_reviews set completed_at = now(),desired_direction = 'Frozen review'
  where user_id = auth.uid() and local_date = v_today-1 returning id into v_source;
  select jsonb_build_object(
    'reviews',(select jsonb_agg(to_jsonb(r) order by local_date) from public.today_v2_daily_reviews r where user_id = auth.uid()),
    'plans',(select jsonb_agg(to_jsonb(p)) from public.today_v2_plan_inputs p where user_id = auth.uid()),
    'actions',(select jsonb_agg(to_jsonb(f) order by fragment_order) from public.today_v2_commitment_fragments f where user_id = auth.uid()),
    'habits',(select jsonb_agg(to_jsonb(h) order by id) from public.today_v2_habit_definitions h where user_id = auth.uid())
  ) into v_before;
  select jsonb_agg(to_jsonb(b) order by id) into v_other from public.today_v2_schedule_blocks b
  where user_id = auth.uid() and id not in (v_block,v_habit_block);
  perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action,
    (v_today + time '11:07') at time zone 'UTC',(v_today + time '11:43') at time zone 'UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_block
    and source_review_id = v_source and starts_at = (v_today + time '11:07') at time zone 'UTC'),
    'Timing edits retain block UUID and completed-source provenance even for answered actions';
  perform public.today_v2_update_day_schedule(v_today,'UTC','habit',v_habit,
    (v_today + time '09:07') at time zone 'UTC',(v_today + time '09:50') at time zone 'UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_habit_block and is_automatic),
    'Unchanged automatic times retain provenance';
  assert not exists(select 1 from public.today_v2_habit_schedule_overrides
    where user_id = auth.uid() and target_local_date = v_today and habit_definition_id = v_habit),
    'No tombstone for unchanged recurrence';
  perform public.today_v2_update_day_schedule(v_today,'UTC','habit',v_habit,
    (v_today + time '23:47') at time zone 'UTC',(v_today + 1 + time '00:17') at time zone 'UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_habit_block and not is_automatic),
    'Overnight current-day override retains UUID and becomes manual';
  assert v_other = (select jsonb_agg(to_jsonb(b) order by id) from public.today_v2_schedule_blocks b
    where user_id = auth.uid() and id not in (v_block,v_habit_block)),
    'Other blocks, past carryovers, and tomorrow remain byte-for-byte unchanged';
  assert v_before = (select jsonb_build_object(
    'reviews',(select jsonb_agg(to_jsonb(r) order by local_date) from public.today_v2_daily_reviews r where user_id = auth.uid()),
    'plans',(select jsonb_agg(to_jsonb(p)) from public.today_v2_plan_inputs p where user_id = auth.uid()),
    'actions',(select jsonb_agg(to_jsonb(f) order by fragment_order) from public.today_v2_commitment_fragments f where user_id = auth.uid()),
    'habits',(select jsonb_agg(to_jsonb(h) order by id) from public.today_v2_habit_definitions h where user_id = auth.uid())
  )), 'No review reopening, commitment/plan/outcome or habit definition mutation';
  perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action_two,
    (v_today + time '12:00') at time zone 'UTC',(v_today + time '12:30') at time zone 'UTC');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_block),
    'A second stale-client identity write does not replace the first';
  perform public.today_v2_update_day_schedule(v_today,'UTC','habit',v_manual,
    (v_today + time '13:00') at time zone 'UTC',(v_today + time '13:30') at time zone 'UTC');
  perform public.today_v2_update_day_schedule(v_today,'UTC','habit',v_habit,null,null);
  perform public.today_v2_update_day_schedule(v_today,'UTC','habit',v_habit,null,null);
  perform public.today_v2_seed_habit_schedules(v_today,v_today,'UTC');
  assert not exists(select 1 from public.today_v2_schedule_blocks where id = v_habit_block),
    'Removal is idempotent and recurrence tombstones survive seeding after source completion';
  assert exists(select 1 from public.today_v2_habit_schedule_overrides
    where user_id = auth.uid() and target_local_date = v_today and habit_definition_id = v_habit),
    'Removed recurrence has a persistent per-day tombstone';
  perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action,null,null);
  assert not exists(select 1 from public.today_v2_schedule_blocks where id = v_block),
    'One action can be unscheduled after its source completes';
  assert exists(select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_action_two),
    'Unscheduling never removes other action blocks';
  for d in -1..1 loop
    if d = 0 then continue; end if;
    v_failed := false;
    begin
      perform public.today_v2_update_day_schedule(v_today+d,'UTC','habit',v_habit,null,null);
    exception when others then v_failed := true; end;
    assert v_failed, 'Past carryovers and future dates cannot be edited with the day RPC';
  end loop;
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'Not/AZone','habit',v_habit,null,null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Invalid timezone rejected';
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'Etc/UTC','habit',v_habit,null,null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Timezone must agree with target review, not an arbitrary client clock';
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'UTC','habit',v_habit,now(),null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Partial-null times rejected atomically';
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action,
    (v_today-1 + time '23:47') at time zone 'UTC',(v_today + time '00:17') at time zone 'UTC');
  exception when others then v_failed := true; end;
  assert v_failed, 'A prior-target carryover cannot be moved through today';
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action,
    (v_today + time '10:00') at time zone 'UTC',(v_today + 2 + time '10:00') at time zone 'UTC');
  exception when others then v_failed := true; end;
  assert v_failed, 'Excessive elapsed duration rejected';
  perform set_config('today_v2.allow_day_schedule','true',true);
  v_failed := false;
  begin update public.today_v2_schedule_blocks set starts_at = starts_at + interval '1 minute'
    where commitment_fragment_id = v_action_two;
  exception when others then v_failed := true; end;
  assert v_failed, 'Spoofed client GUC cannot bypass the source-completion guard';
  v_failed := false;
  begin perform public.today_v2_replace_schedule(v_today,'UTC','[]');
  exception when others then v_failed := true; end;
  assert v_failed, 'Legacy full replacement still rejects a completed source';
  update public.today_v2_daily_reviews set completed_at = now()
  where user_id = auth.uid() and local_date = v_today;
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'UTC','action',v_action_two,null,null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Completed target evidence prevents timing removal';
  assert not exists(select 1 from public.today_v2_day_schedule_writes),
    'Capabilities are cleared after success and rolled back after exceptions';
  perform set_config('test.day_habit_id',v_habit::text,true);
  perform set_config('test.day_action_id',v_action_two::text,true);
end;
$$;
set local role authenticated;
do $$
begin
  assert not has_table_privilege('authenticated','public.today_v2_day_schedule_writes','INSERT'),
    'Clients cannot create an authorization capability';
  assert not has_table_privilege('authenticated','public.today_v2_schedule_blocks','UPDATE'),
    'Only narrowly authorized RPC writers can change timing';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000094',true);
set local role authenticated;
do $$
declare v_failed boolean; v_today date := (statement_timestamp() at time zone 'UTC')::date; kind text;
begin
  foreach kind in array array['action','habit'] loop
    v_failed := false;
    begin perform public.today_v2_update_day_schedule(v_today,'UTC',kind,
      current_setting(case when kind = 'habit' then 'test.day_habit_id' else 'test.day_action_id' end)::uuid,null,null);
    exception when others then v_failed := true; end;
    assert v_failed, 'Foreign source UUID rejected even for unscheduling absent rows';
  end loop;
  assert not exists(select 1 from public.today_v2_schedule_blocks), 'Cross-account RLS preserved';
end;
$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000095',true);
do $$
declare
  v_today date := (statement_timestamp() at time zone 'Pacific/Kiritimati')::date;
  v_habit uuid;
  v_id uuid;
  v_action uuid;
  v_action_id uuid;
  v_target_review uuid;
  v_before jsonb;
  v_failed boolean;
begin
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
  values(auth.uid(),'Authenticated civil-date habit','boolean',array[0,1,2,3,4,5,6]::smallint[])
  returning id into v_habit;
  select id into strict v_id from public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','habit',v_habit,
    (v_today + time '00:07') at time zone 'Pacific/Kiritimati',
    (v_today + time '00:23') at time zone 'Pacific/Kiritimati');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_id
    and target_local_date = v_today and starts_at = (v_today + time '00:07') at time zone 'Pacific/Kiritimati'),
    'Authenticated RPC uses actual chosen civil date and accepts timings before the 4AM boundary';
  update public.today_v2_daily_reviews set completed_at = now()
  where user_id = auth.uid() and local_date = v_today-1;
  perform public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','habit',v_habit,
    (v_today + time '01:07') at time zone 'Pacific/Kiritimati',
    (v_today + time '01:23') at time zone 'Pacific/Kiritimati');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_id),
    'Authenticated timing update works after source completion without extra grants';
  perform public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','habit',v_habit,null,null);
  assert not exists(select 1 from public.today_v2_schedule_blocks where id = v_id),
    'Authenticated unschedule succeeds without direct table writes';
  -- Match addManualFollowThroughItem: no plan and source = target civil day.
  insert into public.today_v2_commitment_fragments(
    user_id,source_local_date,target_local_date,timezone_name,fragment_order,
    fragment_text,normalized_fragment_text,parser_version
  ) values(auth.uid(),v_today,v_today,'Pacific/Kiritimati',0,
    'Same-day ROI action','Same-day ROI action','manual_follow_through_same_day')
  returning id into v_action;
  select id into strict v_target_review from public.today_v2_daily_reviews
  where user_id = auth.uid() and local_date = v_today;
  select to_jsonb(f) into v_before from public.today_v2_commitment_fragments f where id = v_action;
  select id into strict v_action_id from public.today_v2_update_day_schedule(
    v_today,'Pacific/Kiritimati','action',v_action,
    (v_today + time '02:07') at time zone 'Pacific/Kiritimati',
    (v_today + time '02:23') at time zone 'Pacific/Kiritimati');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_action_id
    and commitment_fragment_id = v_action and source_review_id = v_target_review),
    'Owned same-day ROI action schedules with actual same-day review provenance';
  perform public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','action',v_action,
    (v_today + time '03:07') at time zone 'Pacific/Kiritimati',
    (v_today + time '03:23') at time zone 'Pacific/Kiritimati');
  assert exists(select 1 from public.today_v2_schedule_blocks where id = v_action_id
    and source_review_id = v_target_review and starts_at = (v_today + time '03:07') at time zone 'Pacific/Kiritimati'),
    'Same-day timing update preserves block UUID and provenance';
  perform public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','action',v_action,null,null);
  assert not exists(select 1 from public.today_v2_schedule_blocks where id = v_action_id),
    'Owned same-day action can be unscheduled';
  assert v_before = (select to_jsonb(f) from public.today_v2_commitment_fragments f where id = v_action),
    'Same-day scheduling and unscheduling never modify the action or its outcome';
  perform public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','action',v_action,
    (v_today + time '04:07') at time zone 'Pacific/Kiritimati',
    (v_today + time '04:23') at time zone 'Pacific/Kiritimati');
  perform set_config('test.same_day_action',v_action::text,true);
  update public.today_v2_daily_reviews set completed_at = now() where id = v_target_review;
  v_failed := false;
  begin perform public.today_v2_update_day_schedule(v_today,'Pacific/Kiritimati','action',v_action,null,null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Completed target protects same-day action schedules as well';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000094',true);
set local role authenticated;
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.today_v2_update_day_schedule((statement_timestamp() at time zone 'Pacific/Kiritimati')::date,
      'Pacific/Kiritimati','action',current_setting('test.same_day_action')::uuid,null,null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Another user cannot unschedule a same-day action UUID';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
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
  v_failed := false;
  begin perform public.today_v2_update_day_schedule((statement_timestamp() at time zone 'UTC')::date,
    'UTC','habit',current_setting('test.day_habit_id')::uuid,null,null);
  exception when others then v_failed := true; end;
  assert v_failed, 'Anonymous current-day writes are rejected';
end;
$$;
rollback;
