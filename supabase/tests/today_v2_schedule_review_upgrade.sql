-- Run as database owner with psql -v ON_ERROR_STOP=1 -f this_file.sql.
-- Recreates the untouched scheduling schema inside a rollback-only transaction.
begin;
drop trigger if exists today_v2_schedule_review_lock on public.today_v2_schedule_blocks;
drop trigger if exists today_v2_plan_review_lock on public.today_v2_plan_inputs;
drop trigger if exists today_v2_fragment_review_lock on public.today_v2_commitment_fragments;
alter table public.today_v2_schedule_blocks drop column if exists source_review_id;
\ir ../migrations/20261007_today_v2_scheduling.sql
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000085');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000085', true);
insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
values(auth.uid(),'2000-04-01','UTC');
do $$
declare v_action uuid; v_habit uuid; v_changed_habit uuid;
begin
  select id into v_action from public.today_v2_replace_plan_stable(
    '2000-04-02','2000-04-01','UTC','Completed upgrade',array['Completed upgrade'],array[null]::uuid[]);
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
  values(auth.uid(),'Completed upgrade habit','boolean',array[0,1,2,3,4,5,6]::smallint[]) returning id into v_habit;
  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
  values(auth.uid(),'Weekday-changed upgrade habit','boolean',array[0,1,2,3,4,5,6]::smallint[]) returning id into v_changed_habit;
  perform public.today_v2_replace_schedule('2000-04-02','UTC',jsonb_build_array(
    jsonb_build_object('commitment_fragment_id',v_action,'starts_at','2000-04-02T10:00:00Z','ends_at','2000-04-02T11:00:00Z'),
    jsonb_build_object('habit_definition_id',v_changed_habit,'starts_at','2000-04-02T12:00:00Z','ends_at','2000-04-02T13:00:00Z'),
    jsonb_build_object('habit_definition_id',v_habit,'starts_at','2000-04-02T23:30:00Z','ends_at','2000-04-03T00:30:00Z')));
  update public.today_v2_habit_definitions set is_archived = true where id = v_habit;
  update public.today_v2_habit_definitions set schedule_weekdays = array[1]::smallint[] where id = v_changed_habit;
  perform set_config('test.upgrade.schedule_ids',
    (select array_agg(id order by id)::text from public.today_v2_schedule_blocks where user_id = auth.uid()),true);
  perform set_config('test.upgrade.schedule_history',
    (select jsonb_agg(to_jsonb(b) order by id)::text from public.today_v2_schedule_blocks b where user_id = auth.uid()),true);
  update public.today_v2_daily_reviews set completed_at = now() where user_id = auth.uid();
end;
$$;
\ir ../migrations/20261008_today_v2_schedule_review_lock.sql
\ir ../migrations/20261008_today_v2_schedule_review_lock.sql
do $$
declare v_rejected boolean := false;
begin
  assert (select array_agg(id order by id)::text = current_setting('test.upgrade.schedule_ids')
    from public.today_v2_schedule_blocks where user_id = auth.uid()), 'Upgrade must retain existing schedule IDs';
  assert (select jsonb_agg(to_jsonb(b) - 'source_review_id' order by id)::text = current_setting('test.upgrade.schedule_history')
    from public.today_v2_schedule_blocks b where user_id = auth.uid()), 'Upgrade must retain schedule history and timestamps';
  assert (select count(*) = 3 from public.today_v2_schedule_blocks b
    join public.today_v2_daily_reviews r on r.id = b.source_review_id and r.user_id = b.user_id
    where b.user_id = auth.uid() and r.local_date = '2000-04-01' and r.completed_at is not null),
    'Upgrade must backfill completed source-review schedules including archived and weekday-changed habits';
  assert not exists (select 1 from pg_trigger where tgrelid = 'public.today_v2_schedule_blocks'::regclass
    and tgname in ('today_v2_schedule_validate','today_v2_schedule_set_updated_at') and tgenabled <> 'O'),
    'Upgrade must restore schedule validation and timestamp triggers';
  begin
    perform public.today_v2_replace_schedule('2000-04-02','UTC','[]');
  exception when others then
    v_rejected := sqlerrm like 'Source review is completed%';
  end;
  assert v_rejected, 'Completed source review must remain locked after upgrade';
  update public.today_v2_commitment_fragments set completion_state = 'kept', answered_at = now() where user_id = auth.uid();
  update public.today_v2_daily_reviews set completed_at = null where user_id = auth.uid();
  perform public.today_v2_replace_schedule('2000-04-02','UTC','[]');
end;
$$;
rollback;
