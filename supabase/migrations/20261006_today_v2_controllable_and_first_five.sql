alter table public.today_v2_daily_reviews
  add column if not exists controllable_focus text;

alter table public.today_v2_plan_inputs
  add column if not exists first_five_minutes text;

create or replace function public.today_v2_replace_plan_for_date(
  p_target_local_date date,
  p_source_local_date date,
  p_timezone_name text,
  p_raw_plan_text text,
  p_fragment_texts text[],
  p_first_five_minutes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_plan_input_id uuid;
  v_has_answered_fragments boolean;
  v_trimmed_text text;
  v_trimmed_first_five_minutes text;
  v_keep_orders integer[];
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return;
  end if;

  select exists(
    select 1
    from public.today_v2_commitment_fragments fragment
    where fragment.user_id = v_user_id
      and fragment.target_local_date = p_target_local_date
      and fragment.completion_state <> 'unanswered'
  ) into v_has_answered_fragments;

  if v_has_answered_fragments then
    raise exception 'today_v2_replace_plan_for_date cannot overwrite answered fragments';
  end if;

  v_trimmed_text := trim(coalesce(p_raw_plan_text, ''));
  v_trimmed_first_five_minutes := trim(coalesce(p_first_five_minutes, ''));

  if v_trimmed_text = ''
    and coalesce(array_length(p_fragment_texts, 1), 0) = 0
    and v_trimmed_first_five_minutes = '' then
    delete from public.today_v2_commitment_fragments
    where user_id = v_user_id
      and target_local_date = p_target_local_date
      and completion_state = 'unanswered';

    delete from public.today_v2_plan_inputs
    where user_id = v_user_id
      and target_local_date = p_target_local_date;

    return;
  end if;

  insert into public.today_v2_plan_inputs (
    user_id,
    source_local_date,
    target_local_date,
    timezone_name,
    raw_plan_text,
    parser_version,
    first_five_minutes
  ) values (
    v_user_id,
    p_source_local_date,
    p_target_local_date,
    p_timezone_name,
    coalesce(p_raw_plan_text, ''),
    'commitment-fragmentation-v2',
    nullif(v_trimmed_first_five_minutes, '')
  )
  on conflict (user_id, target_local_date)
  do update set
    source_local_date = excluded.source_local_date,
    timezone_name = excluded.timezone_name,
    raw_plan_text = excluded.raw_plan_text,
    parser_version = excluded.parser_version,
    first_five_minutes = excluded.first_five_minutes,
    updated_at = now()
  returning id into v_plan_input_id;

  select coalesce(array_agg((fragment_input.idx - 1)::integer), array[]::integer[])
  into v_keep_orders
  from unnest(coalesce(p_fragment_texts, array[]::text[])) with ordinality as fragment_input(fragment_text, idx)
  where trim(fragment_input.fragment_text) <> '';

  insert into public.today_v2_commitment_fragments (
    plan_input_id,
    user_id,
    source_local_date,
    target_local_date,
    timezone_name,
    fragment_order,
    fragment_text,
    normalized_fragment_text,
    parser_version,
    completion_state
  )
  select
    v_plan_input_id,
    v_user_id,
    p_source_local_date,
    p_target_local_date,
    p_timezone_name,
    fragment_input.idx - 1,
    trim(fragment_input.fragment_text),
    regexp_replace(trim(fragment_input.fragment_text), '\s+', ' ', 'g'),
    'commitment-fragmentation-v2',
    'unanswered'
  from unnest(coalesce(p_fragment_texts, array[]::text[])) with ordinality as fragment_input(fragment_text, idx)
  where trim(fragment_input.fragment_text) <> ''
  on conflict (user_id, target_local_date, fragment_order)
  do update set
    plan_input_id = excluded.plan_input_id,
    source_local_date = excluded.source_local_date,
    timezone_name = excluded.timezone_name,
    fragment_text = excluded.fragment_text,
    normalized_fragment_text = excluded.normalized_fragment_text,
    parser_version = excluded.parser_version,
    updated_at = now();

  delete from public.today_v2_commitment_fragments
  where user_id = v_user_id
    and target_local_date = p_target_local_date
    and completion_state = 'unanswered'
    and not (fragment_order = any(v_keep_orders));
end;
$$;

grant execute on function public.today_v2_replace_plan_for_date(date, date, text, text, text[], text) to authenticated;

notify pgrst, 'reload schema';
