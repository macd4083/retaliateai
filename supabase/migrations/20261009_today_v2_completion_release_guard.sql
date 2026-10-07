-- Additive release guard: apply even when the scheduling repair was already run.
-- One statement makes SQL Editor execution atomic without committing caller transactions.
do $today_v2_completion_guard$
begin
execute $today_v2_completion_guard_ddl$
create or replace function public.today_v2_guard_completed_review()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Loading upserts the browser timezone; retain completed evidence across travel.
  if old.completed_at is not null then new.timezone_name := old.timezone_name; end if;
  if old.completed_at is not null
    and (to_jsonb(new) - array['completed_at','updated_at'])
      <> (to_jsonb(old) - array['completed_at','updated_at']) then
    raise exception 'Review is completed; reopen it before editing';
  end if;
  return new;
end;
$$;
drop trigger if exists today_v2_completed_review_lock on public.today_v2_daily_reviews;
create trigger today_v2_completed_review_lock before update on public.today_v2_daily_reviews
for each row execute function public.today_v2_guard_completed_review();

-- Outcomes belong to the review being answered, not the previous source review.
create or replace function public.today_v2_guard_outcome_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'today_v2_commitment_fragments' then
    if new.completion_state is not distinct from old.completion_state
      and new.answered_at is not distinct from old.answered_at then return new; end if;
    perform public.today_v2_lock_source_review(old.user_id, old.target_local_date, old.timezone_name);
    perform public.today_v2_lock_source_review(new.user_id, new.target_local_date, new.timezone_name);
  else
    if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
    if tg_op <> 'INSERT' then
      perform public.today_v2_lock_source_review(old.user_id, old.local_date, old.timezone_name);
    end if;
    if tg_op = 'DELETE' then return old; end if;
    perform public.today_v2_lock_source_review(new.user_id, new.local_date, new.timezone_name);
  end if;
  return new;
end;
$$;
drop trigger if exists today_v2_fragment_outcome_review_lock on public.today_v2_commitment_fragments;
create trigger today_v2_fragment_outcome_review_lock before update on public.today_v2_commitment_fragments
for each row execute function public.today_v2_guard_outcome_review();
drop trigger if exists today_v2_habit_outcome_review_lock on public.today_v2_habit_occurrences;
create trigger today_v2_habit_outcome_review_lock before insert or update or delete on public.today_v2_habit_occurrences
for each row execute function public.today_v2_guard_outcome_review();

-- Reads may ensure snapshots, but never add new checklist rows to a completed day.
create or replace function public.today_v2_ensure_habit_occurrences_for_date(p_local_date date, p_timezone_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_completed_at timestamptz;
begin
  if auth.uid() is null then return; end if;
  insert into public.today_v2_daily_reviews(user_id,local_date,timezone_name)
  values(auth.uid(),p_local_date,p_timezone_name) on conflict (user_id,local_date) do nothing;
  select completed_at into v_completed_at from public.today_v2_daily_reviews
  where user_id = auth.uid() and local_date = p_local_date for update;
  if v_completed_at is not null then return; end if;
  insert into public.today_v2_habit_occurrences(
    user_id,habit_definition_id,local_date,timezone_name,scheduled_weekday,
    snapshot_name,snapshot_response_type,snapshot_unit,snapshot_display_order
  )
  select h.user_id,h.id,p_local_date,p_timezone_name,extract(dow from p_local_date)::smallint,
    h.name,h.response_type,h.unit,h.display_order
  from public.today_v2_habit_definitions h
  where h.user_id = auth.uid() and not h.is_archived
    and h.schedule_weekdays @> array[extract(dow from p_local_date)::smallint]
    -- Existing response writes lock their occurrence before the review.
    and not exists (select 1 from public.today_v2_habit_occurrences o
      where o.user_id = h.user_id and o.habit_definition_id = h.id and o.local_date = p_local_date)
  on conflict (user_id,habit_definition_id,local_date) do nothing;
end;
$$;

revoke all on function public.today_v2_guard_completed_review() from public, anon, authenticated;
revoke all on function public.today_v2_guard_outcome_review() from public, anon, authenticated;
notify pgrst, 'reload schema';
$today_v2_completion_guard_ddl$;
end;
$today_v2_completion_guard$;
