-- Optimistic concurrency for whole-day replacement; legacy callers remain supported.
create or replace function public.today_v2_replace_schedule_checked(
  p_target_local_date date, p_timezone_name text, p_blocks jsonb, p_expected_blocks jsonb
)
returns setof public.today_v2_schedule_blocks
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_target_local_date is null or not isfinite(p_target_local_date)
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name) then
    raise exception 'Valid target date and timezone required';
  end if;
  if p_expected_blocks is null or jsonb_typeof(p_expected_blocks) <> 'array' then
    raise exception 'Expected schedule must be an array';
  end if;
  if exists (select 1 from jsonb_array_elements(p_expected_blocks) b where jsonb_typeof(b) <> 'object') then
    raise exception 'Each expected schedule block must be an object';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_expected_blocks) as b(
      commitment_fragment_id uuid, habit_definition_id uuid,
      starts_at timestamptz, ends_at timestamptz, timezone_name text
    )
    where (b.commitment_fragment_id is null) = (b.habit_definition_id is null)
      or b.starts_at is null or b.ends_at is null
      or not isfinite(b.starts_at) or not isfinite(b.ends_at)
      or b.ends_at <= b.starts_at or b.ends_at - b.starts_at > interval '24 hours'
      or not exists (select 1 from pg_timezone_names z where z.name = b.timezone_name)
  ) then
    raise exception 'Expected schedule blocks need exactly one source, valid timestamps, and timezone';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_expected_blocks) as b(
      commitment_fragment_id uuid, habit_definition_id uuid
    )
    group by b.commitment_fragment_id, b.habit_definition_id having count(*) > 1
  ) then
    raise exception 'Duplicate expected schedule sources';
  end if;

  perform public.today_v2_lock_source_review(v_user, p_target_local_date - 1, p_timezone_name);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_target_local_date::text, 0));
  if exists (
    with expected as (
      select b.* from jsonb_to_recordset(p_expected_blocks) as b(
        commitment_fragment_id uuid, habit_definition_id uuid,
        starts_at timestamptz, ends_at timestamptz, timezone_name text
      )
      -- The preceding stable plan save may have cascaded removed actions.
      -- Missing habits remain in the baseline so unscheduling is a conflict.
      where b.commitment_fragment_id is null or exists (
        select 1 from public.today_v2_commitment_fragments f
        where f.user_id = v_user and f.target_local_date = p_target_local_date
          and f.id = b.commitment_fragment_id
      )
    ), actual as (
      select commitment_fragment_id, habit_definition_id, starts_at, ends_at, timezone_name
      from public.today_v2_schedule_blocks
      where user_id = v_user and target_local_date = p_target_local_date
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception using errcode = '40001',
      message = 'Calendar changed for this local date; newer saved times kept; local draft preserved. Please reload before saving the schedule.';
  end if;
  return query select * from public.today_v2_replace_schedule(p_target_local_date, p_timezone_name, p_blocks);
end;
$$;

revoke all on function public.today_v2_replace_schedule_checked(date, text, jsonb, jsonb) from public, anon;
grant execute on function public.today_v2_replace_schedule_checked(date, text, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
