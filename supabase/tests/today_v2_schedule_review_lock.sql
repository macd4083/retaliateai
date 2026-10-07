-- psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_schedule_review_lock.sql
-- Requires the 20260928, 20261006, and 20261007 Today V2 migrations.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000081'),
  ('00000000-0000-4000-8000-000000000082');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000081', true);
do $$
declare v_action uuid; v_habit uuid;
begin
  select id into v_action from public.today_v2_replace_plan_stable(
    '2099-02-02','2099-02-01','UTC','Upgrade action',array['Upgrade action'],array[null]::uuid[]);
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
  values(auth.uid(),'Upgrade habit','boolean',array[0,1,2,3,4,5,6]::smallint[]) returning id into v_habit;
  perform public.today_v2_replace_schedule('2099-02-02','UTC',jsonb_build_array(
    jsonb_build_object('commitment_fragment_id',v_action,'starts_at','2099-02-02T10:00:00Z','ends_at','2099-02-02T11:00:00Z'),
    jsonb_build_object('habit_definition_id',v_habit,'starts_at','2099-02-02T23:30:00Z','ends_at','2099-02-03T00:30:00Z')));
end;
$$;
\ir ../migrations/20261008_today_v2_schedule_review_lock.sql
\ir ../migrations/20261008_today_v2_schedule_review_lock.sql
do $$
begin
  assert (select count(*) = 2 from public.today_v2_schedule_blocks b
    join public.today_v2_daily_reviews r on r.id = b.source_review_id
    where b.user_id = auth.uid() and r.user_id = b.user_id and r.local_date = '2099-02-01'),
    'Upgrade must backfill ownership for existing action and habit schedules';
  assert exists (select 1 from public.today_v2_schedule_blocks
    where user_id = auth.uid() and ends_at = '2099-02-03T00:30:00Z'), 'Upgrade must preserve midnight evidence';
  assert exists (select 1 from pg_constraint where conname = 'today_v2_schedule_review_owner_fk'
    and conrelid = 'public.today_v2_schedule_blocks'::regclass and confdeltype = 'c'),
    'Source review deletion must cascade before account deletion checks';
end;
$$;
create function pg_temp.expect_lock_failure(p_sql text) returns void language plpgsql as $$
declare v_failed boolean := false;
begin
  begin execute p_sql; exception when others then v_failed := true; end;
  assert v_failed, 'Expected rejection: ' || p_sql;
end;
$$;

do $$
declare v_action uuid; v_habit uuid; v_review uuid; v_blocks jsonb; v_foreign_review uuid;
begin
  select id into v_action from public.today_v2_replace_plan_stable(
    '2099-02-02','2099-02-01','UTC','Write',array['Write'],array[null]::uuid[]);
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
  values(auth.uid(),'Review lock habit','boolean',array[0,1,2,3,4,5,6]::smallint[]) returning id into v_habit;
  v_blocks := jsonb_build_array(
    jsonb_build_object('commitment_fragment_id',v_action,'starts_at','2099-02-02T10:00:00Z','ends_at','2099-02-02T11:00:00Z'),
    jsonb_build_object('habit_definition_id',v_habit,'starts_at','2099-02-02T23:30:00Z','ends_at','2099-02-03T00:30:00Z'));
  perform public.today_v2_replace_schedule('2099-02-02','UTC',v_blocks);
  select id into v_review from public.today_v2_daily_reviews where user_id = auth.uid() and local_date = '2099-02-01';
  assert (select count(*) = 2 from public.today_v2_schedule_blocks where source_review_id = v_review),
    'Action and habit schedules must belong to the source review';

  update public.today_v2_daily_reviews set completed_at = now() where id = v_review;
  perform pg_temp.expect_lock_failure($q$select public.today_v2_replace_schedule('2099-02-02','UTC','[]')$q$);
  perform pg_temp.expect_lock_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
    '2099-02-02','UTC',v_blocks));
  perform pg_temp.expect_lock_failure(format(
    'update public.today_v2_schedule_blocks set ends_at = ends_at + interval ''15 minutes'' where source_review_id = %L',v_review));
  perform pg_temp.expect_lock_failure(format('delete from public.today_v2_schedule_blocks where source_review_id = %L',v_review));
  perform pg_temp.expect_lock_failure(format(
    'insert into public.today_v2_schedule_blocks(user_id,target_local_date,timezone_name,habit_definition_id,starts_at,ends_at)
    values(%L,%L,%L,%L,%L,%L)',auth.uid(),'2099-02-02','UTC',v_habit,'2099-02-02T12:00:00Z','2099-02-02T13:00:00Z'));
  perform pg_temp.expect_lock_failure(format(
    'select public.today_v2_replace_plan_stable(%L,%L,%L,%L,%L::text[],%L::uuid[])',
    '2099-02-02','2099-02-01','UTC','Changed',array['Changed'],array[v_action]));
  perform pg_temp.expect_lock_failure(format(
    'update public.today_v2_commitment_fragments set fragment_text = ''Changed'' where id = %L',v_action));
  perform pg_temp.expect_lock_failure(format(
    'delete from public.today_v2_commitment_fragments where id = %L',v_action));
  perform pg_temp.expect_lock_failure(format(
    'update public.today_v2_plan_inputs set first_five_minutes = ''Changed'' where user_id = %L and target_local_date = %L',
    auth.uid(),'2099-02-02'));
  perform pg_temp.expect_lock_failure(format(
    'delete from public.today_v2_plan_inputs where user_id = %L and target_local_date = %L',
    auth.uid(),'2099-02-02'));

  update public.today_v2_commitment_fragments set completion_state = 'kept', answered_at = now() where id = v_action;
  assert (select completion_state = 'kept' from public.today_v2_commitment_fragments where id = v_action),
    'Next-day outcomes must remain writable when the source review is completed';
  update public.today_v2_habit_definitions set is_archived = true, archived_at = now() where id = v_habit;
  assert (select count(*) = 2 from public.today_v2_schedule_blocks where source_review_id = v_review),
    'Archiving must preserve completed source-review schedule evidence';

  update public.today_v2_daily_reviews set completed_at = null where id = v_review;
  update public.today_v2_commitment_fragments set completion_state = 'unanswered', answered_at = null where id = v_action;
  update public.today_v2_habit_definitions set is_archived = false, archived_at = null where id = v_habit;
  perform public.today_v2_replace_schedule('2099-02-02','UTC','[]');
  assert not exists (select 1 from public.today_v2_schedule_blocks where source_review_id = v_review), 'Reopen unlocks schedule edits';
  perform public.today_v2_replace_schedule('2099-02-02','UTC',v_blocks);
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
  values('00000000-0000-4000-8000-000000000082','2099-02-01','UTC') returning id into v_foreign_review;
  perform pg_temp.expect_lock_failure(format(
    'update public.today_v2_schedule_blocks set source_review_id = %L where source_review_id = %L',v_foreign_review,v_review));

  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
  perform pg_temp.expect_lock_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
    '2099-02-02','UTC',v_blocks));
  assert (select count(*) = 2 from public.today_v2_schedule_blocks where source_review_id = v_review),
    'Foreign replacement must not affect owned schedules';
end;
$$;
set local role authenticated;
do $$
begin
  assert not exists (select 1 from public.today_v2_schedule_blocks where user_id <> auth.uid());
  perform pg_temp.expect_lock_failure('update public.today_v2_schedule_blocks set ends_at = ends_at + interval ''15 minutes''');
  perform pg_temp.expect_lock_failure('delete from public.today_v2_schedule_blocks');
  assert not has_function_privilege('authenticated',
    'public.today_v2_lock_source_review(uuid,date,text)','EXECUTE');
  assert not has_function_privilege('authenticated',
    'public.today_v2_replace_plan_stable_unlocked(date,date,text,text,text[],uuid[],text)','EXECUTE');
  assert not has_table_privilege('authenticated','public.today_v2_daily_reviews','DELETE'),
    'Browser clients must not bypass completion locks by deleting source reviews';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000081', true);
do $$
declare v_action uuid;
begin
  select id into v_action from public.today_v2_replace_plan_stable(
    '2099-02-04','2099-02-03','UTC','Cascade action',array['Cascade action'],array[null]::uuid[]);
  perform public.today_v2_replace_schedule('2099-02-04','UTC',jsonb_build_array(
    jsonb_build_object('commitment_fragment_id',v_action,'starts_at','2099-02-04T10:00:00Z','ends_at','2099-02-04T11:00:00Z')));
  delete from public.today_v2_plan_inputs where user_id = auth.uid() and target_local_date = '2099-02-04';
  assert not exists (select 1 from public.today_v2_commitment_fragments where id = v_action), 'Unlocked plan deletion must cascade';
  assert not exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_action),
    'Unlocked plan deletion must cascade action schedules';
  select id into v_action from public.today_v2_replace_plan_stable(
    '2099-02-06','2099-02-05','UTC','Review cascade action',array['Review cascade action'],array[null]::uuid[]);
  perform public.today_v2_replace_schedule('2099-02-06','UTC',jsonb_build_array(
    jsonb_build_object('commitment_fragment_id',v_action,'starts_at','2099-02-06T10:00:00Z','ends_at','2099-02-06T11:00:00Z')));
  update public.today_v2_daily_reviews set completed_at = now() where user_id = auth.uid() and local_date = '2099-02-05';
  delete from public.today_v2_daily_reviews where user_id = auth.uid() and local_date = '2099-02-05';
  assert exists (select 1 from auth.users where id = auth.uid()), 'Review-first cascade must not require account removal';
  assert not exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_action),
    'Authorized review-first deletion must cascade schedules safely';
  update public.today_v2_daily_reviews set completed_at = now() where user_id = auth.uid();
  assert (select count(*) = 2 from public.today_v2_schedule_blocks where user_id = auth.uid()),
    'Account cascade fixture must contain completed-review schedules';
  delete from auth.users where id = auth.uid();
  assert not exists (select 1 from public.today_v2_daily_reviews where user_id = auth.uid()), 'Account deletion must cascade reviews';
  assert not exists (select 1 from public.today_v2_plan_inputs where user_id = auth.uid()), 'Account deletion must cascade plans';
  assert not exists (select 1 from public.today_v2_commitment_fragments where user_id = auth.uid()), 'Account deletion must cascade fragments';
  assert not exists (select 1 from public.today_v2_schedule_blocks where user_id = auth.uid()), 'Account deletion must cascade locked schedules';
end;
$$;
rollback;
