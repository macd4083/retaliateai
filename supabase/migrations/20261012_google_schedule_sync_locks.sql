-- Cross-instance serialization for Google Calendar reconciliation.
create table if not exists public.today_v2_google_schedule_sync_locks (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_local_date date not null,
  lease_id uuid not null,
  expires_at timestamptz not null,
  primary key (user_id, target_local_date)
);
alter table public.today_v2_google_schedule_sync_locks enable row level security;
revoke all on public.today_v2_google_schedule_sync_locks from public, anon, authenticated;
grant all on public.today_v2_google_schedule_sync_locks to service_role;

create or replace function public.today_v2_acquire_google_schedule_sync(
  p_user_id uuid, p_target_local_date date, p_lease_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.today_v2_google_schedule_sync_locks
    (user_id, target_local_date, lease_id, expires_at)
  values (p_user_id, p_target_local_date, p_lease_id, clock_timestamp() + interval '60 seconds')
  on conflict (user_id, target_local_date) do update
    set lease_id = excluded.lease_id, expires_at = excluded.expires_at
    where today_v2_google_schedule_sync_locks.expires_at < clock_timestamp();
  return found;
end;
$$;

create or replace function public.today_v2_release_google_schedule_sync(
  p_user_id uuid, p_target_local_date date, p_lease_id uuid
) returns void language sql security definer set search_path = public as $$
  delete from public.today_v2_google_schedule_sync_locks
  where user_id = p_user_id and target_local_date = p_target_local_date
    and lease_id = p_lease_id;
$$;

revoke all on function public.today_v2_acquire_google_schedule_sync(uuid, date, uuid)
  from public, anon, authenticated;
revoke all on function public.today_v2_release_google_schedule_sync(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.today_v2_acquire_google_schedule_sync(uuid, date, uuid) to service_role;
grant execute on function public.today_v2_release_google_schedule_sync(uuid, date, uuid) to service_role;
