-- Run against a LOCAL disposable database with Supabase auth schemas and user_profiles.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/support_inbox.sql
\ir ../migrations/20261011_support_inbox.sql
begin;
insert into auth.users(id) values
('00000000-0000-4000-8000-000000000081'),
('00000000-0000-4000-8000-000000000082');
insert into public.user_profiles(id,role) values
('00000000-0000-4000-8000-000000000081','admin'),
('00000000-0000-4000-8000-000000000082','user');
select public.support_store_message(
'{"id":"00000000-0000-4000-8000-000000000083","provider_email_id":"00000000-0000-4000-8000-000000000084","sender":"sender@example.test","recipients":["support@retaliateai.com"],"cc":[],"subject":"Help","received_at":"2026-10-11T00:00:00Z","text_body":"Body","attachments":[]}',
'{"to":"owner@example.test"}',false);
select public.support_store_message(
'{"id":"00000000-0000-4000-8000-000000000085","provider_email_id":"00000000-0000-4000-8000-000000000084"}',
'{}',false);
do $$ begin
  assert (select count(*) = 1 from public.support_messages), 'Deduplicated message';
  assert (select count(*) = 1 from public.support_claim_notification(null)), 'First claim';
  assert (select count(*) = 0 from public.support_claim_notification(null)), 'Concurrent claim denied';
end $$;
update public.support_notification_jobs set lease_until = now() - interval '1 second';
do $$ begin
  assert (select count(*) = 1 from public.support_claim_notification(null)), 'Recover expired lease';
end $$;
update public.support_notification_jobs set lease_until = now() - interval '1 second',
first_attempt_at = now() - interval '24 hours';
do $$ begin
  assert (select count(*) = 0 from public.support_claim_notification(null)), 'No resend beyond idempotency window';
  assert (select status = 'needs_review' from public.support_notification_jobs), 'Honest ambiguous status';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
set local role authenticated;
do $$ declare denied boolean := false; begin
  assert (select count(*) = 0 from public.support_messages), 'Non-admin read denied';
  delete from public.support_messages;
  begin
    update public.user_profiles set role = 'admin' where id = auth.uid();
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'Self promotion denied';
  denied := false;
  begin
    update public.user_profiles set id = '00000000-0000-4000-8000-000000000086' where role = 'admin';
  exception when insufficient_privilege then denied := true;
  end;
  -- Existing profile RLS may hide other users; ensure it cannot change a visible identity either.
  denied := false;
  begin
    update public.user_profiles set id = '00000000-0000-4000-8000-000000000086' where id = auth.uid();
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'Profile identity cannot change';
  denied := false;
  begin
    perform public.support_claim_notification(null);
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'Client notification mutation denied';
end $$;
reset role;
do $$ begin assert (select count(*) = 1 from public.support_messages), 'Non-admin delete denied'; end $$;
set local role anon;
do $$ declare denied boolean := false; begin
  begin perform * from public.support_messages;
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'Anon read denied';
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
set local role authenticated;
do $$ begin
  assert (select count(*) = 1 from public.support_messages), 'Admin read';
  delete from public.support_messages;
end $$;
reset role;
select public.support_store_message(
'{"id":"00000000-0000-4000-8000-000000000085","provider_email_id":"00000000-0000-4000-8000-000000000084"}',
'{}',false);
do $$ begin
  assert (select count(*) = 0 from public.support_messages), 'Deleted mail not resurrected on replay';
  assert (select payload is null and status = 'suppressed' from public.support_notification_jobs), 'Deletion erases payload and cancels retry';
end $$;
rollback;
