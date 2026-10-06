-- Run with psql -v ON_ERROR_STOP=1 after the Today V2 migrations, as database owner.
-- All fixtures and assertions roll back; auth.uid() uses Supabase's JWT subject setting.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000071'),
  ('00000000-0000-4000-8000-000000000072');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000071', true);

create function pg_temp.expect_failure(p_sql text) returns void language plpgsql as $$
declare v_failed boolean := false;
begin
  begin execute p_sql; exception when others then v_failed := true; end;
  assert v_failed, 'Expected rejection: ' || p_sql;
end;
$$;

do $$
declare
  v_a uuid;
  v_b uuid;
  v_other uuid;
  v_wrong_date uuid;
  v_habit uuid;
  v_blocks jsonb;
  v_bad jsonb;
  v_before uuid[];
  v_bad_ids uuid[];
begin
  perform public.today_v2_replace_plan_stable('2099-01-05', '2099-01-04', 'UTC', 'A and B',
    array['A','B'], array[null,null]::uuid[], 'Open notebook');
  select id into v_a from public.today_v2_commitment_fragments where fragment_text = 'A';
  select id into v_b from public.today_v2_commitment_fragments where fragment_text = 'B';
  assert (select first_five_minutes = 'Open notebook' from public.today_v2_plan_inputs where target_local_date = '2099-01-05');
  v_blocks := jsonb_build_array(jsonb_build_object('commitment_fragment_id', v_a,
    'starts_at', '2099-01-05T23:30:00Z', 'ends_at', '2099-01-06T00:30:00Z'));
  perform public.today_v2_replace_schedule('2099-01-05', 'UTC', v_blocks);
  perform public.today_v2_replace_plan_stable('2099-01-05', '2099-01-04', 'UTC', 'B then A',
    array['B','A edited'], array[v_b,v_a]);
  assert (select fragment_order = 1 and fragment_text = 'A edited' from public.today_v2_commitment_fragments where id = v_a);
  assert (select count(*) = 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_a);

  perform public.today_v2_replace_plan_stable('2099-01-06', '2099-01-05', 'UTC', 'Other date',
    array['Wrong date'], array[null]::uuid[]);
  select id into v_wrong_date from public.today_v2_commitment_fragments where fragment_text = 'Wrong date';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000072', true);
  perform public.today_v2_replace_plan_stable('2099-01-05', '2099-01-04', 'UTC', 'Other user',
    array['Foreign'], array[null]::uuid[]);
  select id into v_other from public.today_v2_commitment_fragments where fragment_text = 'Foreign';
  perform public.today_v2_replace_schedule('2099-01-05','UTC',
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_other,
      'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T11:00:00Z')));
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000071', true);
  foreach v_bad_ids slice 1 in array array[array[v_other,v_a],array[v_wrong_date,v_a],array[v_a,v_a]] loop
    perform pg_temp.expect_failure(format(
      'select public.today_v2_replace_plan_stable(%L,%L,%L,%L,%L::text[],%L::uuid[])',
      '2099-01-05','2099-01-04','UTC','Invalid',array['X','Y'],v_bad_ids));
  end loop;
  perform pg_temp.expect_failure($q$select public.today_v2_replace_plan_stable(
    '2099-01-05','2099-01-04','UTC','Invalid',array['X'],array[]::uuid[])$q$);
  perform pg_temp.expect_failure($q$select public.today_v2_replace_plan_stable(
    '2099-01-05','2099-01-04','Invalid/Zone','Invalid',array[]::text[],array[]::uuid[])$q$);
  perform pg_temp.expect_failure($q$select public.today_v2_replace_plan_stable(
    '2099-01-05','2099-01-04','UTC','Invalid',array[''],array[null]::uuid[])$q$);

  select array_agg(id order by id) into v_before from public.today_v2_schedule_blocks;
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_other,'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T11:00:00Z')),
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_wrong_date,'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T11:00:00Z')),
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_a,'starts_at','2099-01-04T10:00:00Z','ends_at','2099-01-04T11:00:00Z')),
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_a,'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T10:00:00Z')),
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_a,'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-06T10:01:00Z')),
    jsonb_build_array(jsonb_build_object('starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T11:00:00Z')),
    v_blocks || v_blocks, 'null'::jsonb, '{}'::jsonb, '[null]'::jsonb
  )) loop
    perform pg_temp.expect_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
      '2099-01-05','UTC',v_bad));
    assert (select array_agg(id order by id) = v_before from public.today_v2_schedule_blocks), 'Failed replace must roll back';
  end loop;
  perform pg_temp.expect_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
    '2099-01-05','Invalid/Zone',v_blocks));
  perform public.today_v2_replace_schedule('2099-01-05','America/Los_Angeles',
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_a,
      'starts_at','2099-01-06T06:00:00Z','ends_at','2099-01-06T07:00:00Z')));
  perform public.today_v2_replace_plan_for_date('2099-01-05','2099-01-04','UTC','Legacy edit',array['B','A legacy'],null);
  assert not exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_a), 'Legacy edits clear schedules';
  perform public.today_v2_replace_schedule('2099-01-05','UTC',v_blocks);
  perform public.today_v2_replace_plan_for_date('2099-01-05','2099-01-04','UTC','Legacy five',array['B','A five']);
  assert not exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_a);
  perform public.today_v2_replace_schedule('2099-01-05','UTC',v_blocks);
  perform public.today_v2_replace_plan_stable('2099-01-05','2099-01-04','UTC','Only B',array['B'],array[v_b]);
  assert not exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_a), 'Removed sources cascade schedules';
  update public.today_v2_commitment_fragments set completion_state = 'kept', answered_at = now() where id = v_b;
  perform pg_temp.expect_failure(format(
    'select public.today_v2_replace_plan_stable(%L,%L,%L,%L,%L::text[],%L::uuid[])',
    '2099-01-05','2099-01-04','UTC','B',array['B'],array[v_b]));
  assert (select completion_state = 'kept' from public.today_v2_commitment_fragments where id = v_b);

  insert into public.today_v2_habit_definitions(user_id,name,response_type,schedule_weekdays)
    values(auth.uid(),'Scheduling test','boolean',array[extract(dow from date '2099-01-05')::smallint]) returning id into v_habit;
  perform public.today_v2_ensure_habit_occurrences_for_date('2020-01-05','UTC');
  insert into public.today_v2_habit_occurrences(
    user_id,habit_definition_id,local_date,timezone_name,scheduled_weekday,snapshot_name,snapshot_response_type,
    boolean_response,answered_at
  ) values(auth.uid(),v_habit,'2020-01-06','UTC',1,'Scheduling test','boolean',true,now());
  perform public.today_v2_replace_schedule('2099-01-05','UTC',
    jsonb_build_array(jsonb_build_object('habit_definition_id',v_habit,'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-06T10:00:00Z')));
  perform public.today_v2_replace_schedule('2020-01-06','UTC',
    jsonb_build_array(jsonb_build_object('habit_definition_id',v_habit,'starts_at','2020-01-06T10:00:00Z','ends_at','2020-01-06T11:00:00Z')));
  perform public.today_v2_replace_schedule('2099-01-12','UTC',
    jsonb_build_array(jsonb_build_object('habit_definition_id',v_habit,'starts_at','2099-01-12T10:00:00Z','ends_at','2099-01-12T11:00:00Z')));
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name,completed_at)
    values(auth.uid(),'2099-01-12','UTC',now());
  perform pg_temp.expect_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
    '2099-01-06','UTC',jsonb_build_array(jsonb_build_object('habit_definition_id',v_habit,
      'starts_at','2099-01-06T10:00:00Z','ends_at','2099-01-06T11:00:00Z'))));
  perform pg_temp.expect_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
    '2099-01-05','UTC',jsonb_build_array(jsonb_build_object('habit_definition_id',v_habit,
      'commitment_fragment_id',v_b,'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T11:00:00Z'))));
  update public.today_v2_habit_definitions set is_archived = true, archived_at = now() where id = v_habit;
  assert not exists (select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit and target_local_date = '2099-01-05');
  assert exists (select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit and target_local_date = '2099-01-12'), 'Archive preserves completed-day schedule evidence';
  assert exists (select 1 from public.today_v2_schedule_blocks where habit_definition_id = v_habit and starts_at < now()), 'Archive preserves historical blocks';
  assert exists (select 1 from public.today_v2_habit_occurrences where habit_definition_id = v_habit and boolean_response), 'Archive preserves evidence';
  perform pg_temp.expect_failure(format('select public.today_v2_replace_schedule(%L,%L,%L::jsonb)',
    '2099-01-05','UTC',jsonb_build_array(jsonb_build_object('habit_definition_id',v_habit,
      'starts_at','2099-01-05T10:00:00Z','ends_at','2099-01-05T11:00:00Z'))));
end;
$$;

insert into public.today_v2_google_oauth_states values
  ('test-live','00000000-0000-4000-8000-000000000071',now()+interval '5 minutes','test-encrypted','/today'),
  ('test-expired','00000000-0000-4000-8000-000000000071',now()-interval '5 minutes','test-encrypted','/today');
do $$
begin
  assert (select count(*) = 1 from public.today_v2_consume_google_state('test-live'));
  assert (select count(*) = 0 from public.today_v2_consume_google_state('test-live'));
  assert (select count(*) = 0 from public.today_v2_consume_google_state('test-expired'));
  assert not has_table_privilege('authenticated','public.today_v2_google_connections','SELECT');
  assert not has_table_privilege('anon','public.today_v2_google_oauth_states','SELECT');
  assert not has_function_privilege('authenticated','public.today_v2_consume_google_state(text)','EXECUTE');
  assert has_function_privilege('service_role','public.today_v2_consume_google_state(text)','EXECUTE');
  assert not has_table_privilege('authenticated','public.today_v2_schedule_blocks','INSERT');
end;
$$;
set local role authenticated;
do $$
declare v_fragment uuid;
begin
  assert not exists (select 1 from public.today_v2_schedule_blocks where user_id <> auth.uid());
  select id into v_fragment from public.today_v2_replace_plan_stable(
    '2099-01-07','2099-01-06','UTC','Browser plan',array['Browser fragment'],array[null]::uuid[]);
  perform public.today_v2_replace_schedule('2099-01-07','UTC',
    jsonb_build_array(jsonb_build_object('commitment_fragment_id',v_fragment,
      'starts_at','2099-01-07T10:00:00Z','ends_at','2099-01-07T11:00:00Z')));
  assert exists (select 1 from public.today_v2_schedule_blocks where commitment_fragment_id = v_fragment);
  perform pg_temp.expect_failure('select * from public.today_v2_google_oauth_states');
  perform pg_temp.expect_failure('select * from public.today_v2_consume_google_state(''test-expired'')');
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_failure($q$select public.today_v2_replace_schedule('2099-01-05','UTC','[]')$q$);
end;
$$;
reset role;
rollback;
