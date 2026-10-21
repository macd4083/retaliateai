-- psql -v ON_ERROR_STOP=1 -f supabase/tests/google_schedule_sync_locks.sql
begin;
\ir ../migrations/20261012_google_schedule_sync_locks.sql
\ir ../migrations/20261012_google_schedule_sync_locks.sql
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000091'),
  ('00000000-0000-4000-8000-000000000092');
do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000000091';
  v_other uuid := '00000000-0000-4000-8000-000000000092';
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
begin
  assert not has_function_privilege('authenticated',
    'public.today_v2_acquire_google_schedule_sync(uuid,date,uuid)', 'execute'),
    'Clients must not acquire another user''s lease';
  assert not has_function_privilege('anon',
    'public.today_v2_release_google_schedule_sync(uuid,date,uuid)', 'execute'),
    'Anonymous callers must not release leases';
  assert not has_table_privilege('authenticated',
    'public.today_v2_google_schedule_sync_locks', 'select'),
    'Lease metadata must remain server-only';
  assert has_function_privilege('service_role',
    'public.today_v2_acquire_google_schedule_sync(uuid,date,uuid)', 'execute');
  assert public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-02', v_first);
  assert not public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-02', v_second),
    'Only one active lease may reconcile an owned date';
  assert public.today_v2_acquire_google_schedule_sync(v_other, '2099-02-02', v_second);
  assert public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-03', v_second);
  perform public.today_v2_release_google_schedule_sync(v_user, '2099-02-02', v_second);
  assert not public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-02', v_second),
    'A stale release must not unlock the current worker';
  update public.today_v2_google_schedule_sync_locks set expires_at = clock_timestamp() - interval '1 second'
    where user_id = v_user and target_local_date = '2099-02-02';
  assert public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-02', v_second),
    'Expired leases must recover crashed workers';
  perform public.today_v2_release_google_schedule_sync(v_user, '2099-02-02', v_first);
  assert not public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-02', v_first),
    'A recovered worker must not be unlocked by an older owner';
  perform public.today_v2_release_google_schedule_sync(v_user, '2099-02-02', v_second);
  assert public.today_v2_acquire_google_schedule_sync(v_user, '2099-02-02', v_first);
end;
$$;
rollback;
