-- psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_schedule_conflicts.sql
-- Requires Today V2 migrations through 20261013.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000091'),
  ('00000000-0000-4000-8000-000000000092');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000091', true);

create function pg_temp.expect_schedule_failure(
  p_date date, p_blocks jsonb, p_expected jsonb, p_state text, p_message text
) returns void language plpgsql as $$
declare v_failed boolean := false; v_before jsonb; v_overrides jsonb;
begin
  select jsonb_agg(to_jsonb(b) order by id) into v_before from public.today_v2_schedule_blocks b;
  select jsonb_agg(to_jsonb(o) order by user_id,target_local_date,habit_definition_id)
    into v_overrides from public.today_v2_habit_schedule_overrides o;
  begin
    perform public.today_v2_replace_schedule_checked(p_date,'UTC',p_blocks,p_expected);
  exception when others then
    assert sqlstate = p_state, 'Unexpected SQLSTATE: ' || sqlstate || ': ' || sqlerrm;
    assert sqlerrm ~* p_message, 'Unexpected message: ' || sqlerrm;
    if p_state = '40001' then
      assert sqlerrm like '%newer saved times kept; local draft preserved%',
        'Conflicts must explain that saved times and the local draft are preserved';
    end if;
    v_failed := true;
  end;
  assert v_failed, 'Expected checked replacement to fail';
  assert v_before is not distinct from
    (select jsonb_agg(to_jsonb(b) order by id) from public.today_v2_schedule_blocks b),
    'Rejected replacement must leave all schedule rows untouched';
  assert v_overrides is not distinct from
    (select jsonb_agg(to_jsonb(o) order by user_id,target_local_date,habit_definition_id)
      from public.today_v2_habit_schedule_overrides o),
    'Rejected replacement must not record recurrence overrides';
end;
$$;

set local role authenticated;
do $$
declare
  v_date date := (statement_timestamp() at time zone 'UTC')::date;
  v_action uuid; v_habit uuid; v_source uuid; v_type text;
  v_baseline jsonb; v_blocks jsonb; v_expected jsonb; v_bad jsonb;
  v_count integer;
begin
  select id into v_action from public.today_v2_replace_plan_stable(
    v_date,v_date-1,'UTC','Conflict action',array['Conflict action'],array[null]::uuid[]);
  insert into public.today_v2_habit_definitions(user_id,name,response_type)
  values(auth.uid(),'Conflict habit','boolean') returning id into v_habit;
  v_blocks := jsonb_build_array(
    jsonb_build_object('commitment_fragment_id',v_action,
      'starts_at',v_date::text || 'T10:00:00Z','ends_at',v_date::text || 'T11:00:00Z'),
    jsonb_build_object('habit_definition_id',v_habit,
      'starts_at',v_date::text || 'T12:00:00Z','ends_at',v_date::text || 'T13:00:00Z'));
  select count(*) into v_count from public.today_v2_replace_schedule_checked(v_date,'UTC',v_blocks,'[]');
  assert v_count = 2, 'Empty initial baseline must allow first save and return rows';
  select jsonb_agg(to_jsonb(b) order by starts_at)
    into v_baseline from public.today_v2_schedule_blocks b where user_id = auth.uid();

  foreach v_type in array array['action','habit'] loop
    v_source := case when v_type = 'action' then v_action else v_habit end;
    select jsonb_agg(b) into v_expected from jsonb_array_elements(v_baseline) b
    where coalesce(b->>'commitment_fragment_id',b->>'habit_definition_id') <> v_source::text;
    perform public.today_v2_update_day_schedule(v_date,'UTC',v_type,v_source,null,null);
    perform public.today_v2_update_day_schedule(v_date,'UTC',v_type,v_source,
      (v_blocks->(case when v_type = 'action' then 0 else 1 end)->>'starts_at')::timestamptz,
      (v_blocks->(case when v_type = 'action' then 0 else 1 end)->>'ends_at')::timestamptz);
    perform pg_temp.expect_schedule_failure(v_date,v_blocks,v_expected,'40001','Calendar changed.*local.*reload');
    -- Real Home writer moves and unschedules each source while Part 2 holds its baseline.
    perform public.today_v2_update_day_schedule(v_date,'UTC',v_type,v_source,
      (v_date::text || 'T14:00:00Z')::timestamptz,(v_date::text || 'T15:00:00Z')::timestamptz);
    -- Demonstrate the original unchecked lost update before checking its replacement.
    perform public.today_v2_replace_schedule(v_date,'UTC',v_blocks);
    assert (select starts_at = (v_blocks->(case when v_type = 'action' then 0 else 1 end)->>'starts_at')::timestamptz
      from public.today_v2_schedule_blocks
      where user_id = auth.uid() and target_local_date = v_date
        and (case when v_type = 'action' then commitment_fragment_id else habit_definition_id end) = v_source),
      'Legacy replacement reproduces the bug: stale Part 2 silently overwrites the Home move';
    perform public.today_v2_update_day_schedule(v_date,'UTC',v_type,v_source,
      (v_date::text || 'T14:00:00Z')::timestamptz,(v_date::text || 'T15:00:00Z')::timestamptz);
    perform pg_temp.expect_schedule_failure(v_date,v_blocks,v_baseline,'40001','Calendar changed.*local.*reload');
    perform public.today_v2_replace_schedule(v_date,'UTC',v_blocks);
    perform public.today_v2_update_day_schedule(v_date,'UTC',v_type,v_source,null,null);
    perform pg_temp.expect_schedule_failure(v_date,v_blocks,v_baseline,'40001','Calendar changed.*local.*reload');
    perform public.today_v2_replace_schedule(v_date,'UTC',v_blocks);
  end loop;

  foreach v_bad in array array[
    null::jsonb, 'null'::jsonb, '{}'::jsonb, '[null]'::jsonb, '[1]'::jsonb, '[{}]'::jsonb,
    jsonb_build_array(v_baseline->0 || jsonb_build_object('habit_definition_id',v_habit)),
    jsonb_build_array(v_baseline->0 || '{"starts_at":null}'::jsonb),
    jsonb_build_array(v_baseline->0 || '{"ends_at":null}'::jsonb),
    jsonb_build_array(v_baseline->0 || '{"timezone_name":null}'::jsonb),
    jsonb_build_array(v_baseline->0 || '{"timezone_name":"not/a_timezone"}'::jsonb),
    jsonb_build_array(v_baseline->0 || '{"starts_at":"infinity"}'::jsonb),
    jsonb_build_array(v_baseline->0 || jsonb_build_object('ends_at',v_date::text || 'T09:00:00Z'))
  ] loop
    perform pg_temp.expect_schedule_failure(v_date,'[]',v_bad,'P0001','Expected|Each expected');
  end loop;
  perform pg_temp.expect_schedule_failure(v_date,'[]',
    jsonb_build_array(v_baseline->0,v_baseline->0),'P0001','Duplicate expected');
  perform pg_temp.expect_schedule_failure(v_date,'[]',
    jsonb_build_array(v_baseline->1,v_baseline->1),'P0001','Duplicate expected');
  perform pg_temp.expect_schedule_failure(v_date,'[]',
    jsonb_build_array(v_baseline->0 || '{"starts_at":"invalid"}'::jsonb),'22007','timestamp');
  perform pg_temp.expect_schedule_failure(v_date,'[]',
    jsonb_build_array(v_baseline->0 || '{"commitment_fragment_id":"invalid"}'::jsonb),'22P02','uuid');

  update public.today_v2_daily_reviews set completed_at = now() where user_id = auth.uid() and local_date = v_date-1;
  perform pg_temp.expect_schedule_failure(v_date,'[]',v_baseline,'P0001','review is completed');
  update public.today_v2_daily_reviews set completed_at = null where user_id = auth.uid() and local_date = v_date-1;

  -- Save a baseline for the superuser-only metadata/timezone cases below.
  perform set_config('test.schedule_baseline',v_baseline::text,true);
  perform set_config('test.schedule_blocks',v_blocks::text,true);
end;
$$;
reset role;

do $$
declare
  v_date date := (statement_timestamp() at time zone 'UTC')::date;
  v_baseline jsonb := current_setting('test.schedule_baseline')::jsonb;
  v_blocks jsonb := current_setting('test.schedule_blocks')::jsonb;
  v_expected jsonb; v_ids uuid[]; v_ids_after uuid[]; v_type text; v_action uuid;
begin
  foreach v_type in array array['action','habit'] loop
    update public.today_v2_schedule_blocks set timezone_name = 'Etc/UTC'
    where user_id = auth.uid() and (case when v_type = 'action' then commitment_fragment_id else habit_definition_id end) is not null;
    perform pg_temp.expect_schedule_failure(v_date,v_blocks,v_baseline,'40001','Calendar changed.*local.*reload');
    update public.today_v2_schedule_blocks set timezone_name = 'UTC' where user_id = auth.uid();
  end loop;
  update public.today_v2_schedule_blocks set is_automatic = true, updated_at = now() - interval '1 hour'
  where user_id = auth.uid() and habit_definition_id is not null;
  select array_agg(id order by starts_at) into v_ids from public.today_v2_schedule_blocks where user_id = auth.uid();
  -- Reverse order, equivalent offset timestamps, and ignored metadata must not conflict.
  select jsonb_agg(b || jsonb_build_object(
    'starts_at',to_char((b->>'starts_at')::timestamptz at time zone 'Etc/GMT-2','YYYY-MM-DD"T"HH24:MI:SS') || '+02:00',
    'ends_at',to_char((b->>'ends_at')::timestamptz at time zone 'Etc/GMT-2','YYYY-MM-DD"T"HH24:MI:SS') || '+02:00',
    'id',gen_random_uuid(),'is_automatic',false,'updated_at','old') order by ord desc)
  into v_expected from jsonb_array_elements(v_baseline) with ordinality x(b,ord);
  perform public.today_v2_replace_schedule_checked(v_date,'UTC',v_blocks,v_expected);
  select array_agg(id order by starts_at) into v_ids_after from public.today_v2_schedule_blocks where user_id = auth.uid();
  assert v_ids = v_ids_after, 'Unchanged replacement must preserve stable schedule UUIDs';
  assert (select is_automatic from public.today_v2_schedule_blocks where user_id = auth.uid() and habit_definition_id is not null),
    'Unchanged automatic block must retain automatic provenance';

  -- Deleted habit definitions must still conflict, unlike action removal by plan save.
  delete from public.today_v2_habit_definitions where user_id = auth.uid();
  perform pg_temp.expect_schedule_failure(v_date,'[]',v_baseline,'40001','Calendar changed.*local.*reload');
  select jsonb_agg(b) into v_expected from jsonb_array_elements(v_baseline) b
  where b->>'commitment_fragment_id' is not null;
  perform public.today_v2_replace_plan_stable(v_date,v_date-1,'UTC','',array[]::text[],array[]::uuid[]);
  assert not exists (select 1 from public.today_v2_schedule_blocks where user_id = auth.uid()),
    'Own preceding plan save must cascade action removal';
  perform public.today_v2_replace_schedule_checked(v_date,'UTC','[]',v_expected);
  -- Even a deleted action cannot hide a malformed or duplicate baseline.
  perform pg_temp.expect_schedule_failure(v_date,'[]',v_expected || v_expected,'P0001','Duplicate expected');
  perform pg_temp.expect_schedule_failure(v_date,'[]',
    jsonb_build_array(v_expected->0 || '{"timezone_name":null}'::jsonb),'P0001','Expected schedule');
  perform public.today_v2_replace_schedule_checked(v_date,'UTC','[]','[]');
  update public.today_v2_daily_reviews set completed_at = now() where user_id = auth.uid() and local_date = v_date-1;
  perform pg_temp.expect_schedule_failure(v_date,'[]','[]','P0001','review is completed');
  update public.today_v2_daily_reviews set completed_at = null where user_id = auth.uid() and local_date = v_date-1;
  select id into v_action from public.today_v2_replace_plan_stable(
    v_date,v_date-1,'UTC','New action',array['New action'],array[null]::uuid[]);
  v_blocks := jsonb_build_array(v_blocks->0 || jsonb_build_object('commitment_fragment_id',v_action));
  perform public.today_v2_replace_schedule_checked(v_date,'UTC',v_blocks,'[]');
  select jsonb_agg(to_jsonb(b)) into v_expected from public.today_v2_schedule_blocks b where user_id = auth.uid();
  perform public.today_v2_replace_schedule_checked(v_date,'UTC','[]',v_expected);
  assert not exists (select 1 from public.today_v2_schedule_blocks where user_id = auth.uid()),
    'Matching nonempty baseline must permit empty replacement';
  perform public.today_v2_replace_schedule_checked(v_date,'UTC',v_blocks,'[]');
  perform set_config('test.schedule_blocks',v_blocks::text,true);
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000092', true);
set local role authenticated;
do $$
declare v_date date := (statement_timestamp() at time zone 'UTC')::date;
begin
  assert not exists (select 1 from public.today_v2_schedule_blocks), 'RLS must hide other users'' blocks';
  perform pg_temp.expect_schedule_failure(v_date,current_setting('test.schedule_blocks')::jsonb,'[]',
    'P0002','no rows');
  perform public.today_v2_replace_schedule_checked(v_date,'UTC','[]','[]');
  assert has_function_privilege('authenticated','public.today_v2_replace_schedule_checked(date,text,jsonb,jsonb)','EXECUTE');
  assert not has_function_privilege('anon','public.today_v2_replace_schedule_checked(date,text,jsonb,jsonb)','EXECUTE');
end;
$$;
reset role;
do $$
declare v_date date := (statement_timestamp() at time zone 'UTC')::date;
begin
  assert (select count(*) = 1 from public.today_v2_schedule_blocks
    where user_id = '00000000-0000-4000-8000-000000000091'),
    'Other user''s checked replacement must not alter owner''s schedule';
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_schedule_failure(v_date,'[]','[]','P0001','Authentication required');
end;
$$;
rollback;
