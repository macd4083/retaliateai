-- Repair only: retain the original workflow and scheduling migration history.
-- Apply transactionally: Supabase migration runner, or psql --single-transaction.
alter table public.today_v2_schedule_blocks add column if not exists source_review_id uuid;
create unique index if not exists idx_today_v2_reviews_owner_id
  on public.today_v2_daily_reviews(user_id, id);

insert into public.today_v2_daily_reviews(user_id, local_date, timezone_name)
select distinct b.user_id, coalesce(f.source_local_date, b.target_local_date - 1), b.timezone_name
from public.today_v2_schedule_blocks b
left join public.today_v2_commitment_fragments f on f.id = b.commitment_fragment_id
on conflict (user_id, local_date) do nothing;
-- Backfill provenance without revalidating historical habit definitions or changing
-- their schedule timestamps. Trigger changes and the update roll back together.
do $$
begin
  alter table public.today_v2_schedule_blocks disable trigger today_v2_schedule_validate;
  alter table public.today_v2_schedule_blocks disable trigger today_v2_schedule_set_updated_at;
  update public.today_v2_schedule_blocks b set source_review_id = r.id
  from public.today_v2_daily_reviews r
  where r.user_id = b.user_id
    and r.local_date = coalesce(
      (select f.source_local_date from public.today_v2_commitment_fragments f where f.id = b.commitment_fragment_id),
      b.target_local_date - 1)
    and b.source_review_id is null;
  alter table public.today_v2_schedule_blocks enable trigger today_v2_schedule_validate;
  alter table public.today_v2_schedule_blocks enable trigger today_v2_schedule_set_updated_at;
end;
$$;
alter table public.today_v2_schedule_blocks alter column source_review_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'today_v2_schedule_review_owner_fk'
    and conrelid = 'public.today_v2_schedule_blocks'::regclass) then
    alter table public.today_v2_schedule_blocks add constraint today_v2_schedule_review_owner_fk
      foreign key (user_id, source_review_id) references public.today_v2_daily_reviews(user_id, id);
  end if;
end;
$$;

-- Every writer locks the same review row that completion/reopen updates.
create or replace function public.today_v2_lock_source_review(p_user_id uuid, p_local_date date, p_timezone_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_review public.today_v2_daily_reviews;
begin
  insert into public.today_v2_daily_reviews(user_id, local_date, timezone_name)
  values(p_user_id, p_local_date, p_timezone_name)
  on conflict (user_id, local_date) do nothing;
  select * into strict v_review from public.today_v2_daily_reviews
  where user_id = p_user_id and local_date = p_local_date for update;
  if v_review.completed_at is not null then
    raise exception 'Source review is completed; reopen it before editing';
  end if;
  return v_review.id;
end;
$$;

create or replace function public.today_v2_guard_schedule_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_date date; v_review_id uuid;
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if tg_op <> 'INSERT' then
    select local_date into strict v_date from public.today_v2_daily_reviews
    where id = old.source_review_id and user_id = old.user_id;
    perform public.today_v2_lock_source_review(old.user_id, v_date, old.timezone_name);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.commitment_fragment_id is not null then
    select source_local_date into strict v_date from public.today_v2_commitment_fragments
    where id = new.commitment_fragment_id and user_id = new.user_id and target_local_date = new.target_local_date;
  else
    v_date := new.target_local_date - 1;
  end if;
  v_review_id := public.today_v2_lock_source_review(new.user_id, v_date, new.timezone_name);
  if new.source_review_id is not null and new.source_review_id <> v_review_id then
    raise exception 'Schedule source review must match its owned source';
  end if;
  new.source_review_id := v_review_id;
  return new;
end;
$$;
drop trigger if exists today_v2_schedule_review_lock on public.today_v2_schedule_blocks;
create trigger today_v2_schedule_review_lock before insert or update or delete on public.today_v2_schedule_blocks
for each row execute function public.today_v2_guard_schedule_review();

create or replace function public.today_v2_guard_plan_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  -- Answering tomorrow's checklist does not mutate yesterday's plan.
  if tg_table_name = 'today_v2_commitment_fragments' and tg_op = 'UPDATE'
    and (to_jsonb(new) - array['completion_state','answered_at','updated_at'])
      = (to_jsonb(old) - array['completion_state','answered_at','updated_at']) then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    perform public.today_v2_lock_source_review(old.user_id, old.source_local_date, old.timezone_name);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  perform public.today_v2_lock_source_review(new.user_id, new.source_local_date, new.timezone_name);
  return new;
end;
$$;
drop trigger if exists today_v2_plan_review_lock on public.today_v2_plan_inputs;
create trigger today_v2_plan_review_lock before insert or update or delete on public.today_v2_plan_inputs
for each row execute function public.today_v2_guard_plan_review();
drop trigger if exists today_v2_fragment_review_lock on public.today_v2_commitment_fragments;
create trigger today_v2_fragment_review_lock before insert or update or delete on public.today_v2_commitment_fragments
for each row execute function public.today_v2_guard_plan_review();

-- Preserve the stable implementation, but acquire review locks before target locks.
do $$
begin
  if to_regprocedure('public.today_v2_replace_plan_stable_unlocked(date,date,text,text,text[],uuid[],text)') is null then
    alter function public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text)
      rename to today_v2_replace_plan_stable_unlocked;
  end if;
end;
$$;
create or replace function public.today_v2_replace_plan_stable(
  p_target_local_date date, p_source_local_date date, p_timezone_name text,
  p_raw_plan_text text, p_fragment_texts text[], p_fragment_ids uuid[], p_first_five_minutes text default null
)
returns setof public.today_v2_commitment_fragments
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.today_v2_lock_source_review(auth.uid(), p_source_local_date, p_timezone_name);
  return query select * from public.today_v2_replace_plan_stable_unlocked(
    p_target_local_date, p_source_local_date, p_timezone_name, p_raw_plan_text,
    p_fragment_texts, p_fragment_ids, p_first_five_minutes);
end;
$$;

create or replace function public.today_v2_replace_plan_for_date(
  p_target_local_date date, p_source_local_date date, p_timezone_name text,
  p_raw_plan_text text, p_fragment_texts text[], p_first_five_minutes text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_texts text[]; v_ids uuid[];
begin
  if auth.uid() is null then return; end if;
  perform public.today_v2_lock_source_review(auth.uid(), p_source_local_date, p_timezone_name);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_target_local_date::text, 0));
  delete from public.today_v2_schedule_blocks b using public.today_v2_commitment_fragments f
  where b.commitment_fragment_id = f.id and f.user_id = auth.uid() and f.target_local_date = p_target_local_date
    and not exists (
      select 1 from unnest(p_fragment_texts) with ordinality x(t, ord)
      where ord - 1 = f.fragment_order and trim(t) = f.fragment_text
    );
  select coalesce(array_agg(trim(x.t) order by x.ord), '{}'::text[]),
    coalesce(array_agg(f.id order by x.ord), '{}'::uuid[]) into v_texts, v_ids
  from unnest(p_fragment_texts) with ordinality x(t, ord)
  left join public.today_v2_commitment_fragments f
    on f.user_id = auth.uid() and f.target_local_date = p_target_local_date and f.fragment_order = x.ord - 1
  where trim(x.t) <> '';
  perform public.today_v2_replace_plan_stable(p_target_local_date, p_source_local_date, p_timezone_name,
    p_raw_plan_text, v_texts, v_ids, p_first_five_minutes);
end;
$$;

create or replace function public.today_v2_replace_schedule(
  p_target_local_date date, p_timezone_name text, p_blocks jsonb
)
returns setof public.today_v2_schedule_blocks
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_target_local_date is null
    or not exists (select 1 from pg_timezone_names where name = p_timezone_name)
    or p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'Valid target date, timezone, and block array required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_blocks) b where jsonb_typeof(b) <> 'object') then
    raise exception 'Each schedule block must be an object';
  end if;
  -- Lock even an empty replacement or a habit-only plan with no existing blocks.
  perform public.today_v2_lock_source_review(v_user_id, p_target_local_date - 1, p_timezone_name);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_target_local_date::text, 0));
  delete from public.today_v2_schedule_blocks where user_id = v_user_id and target_local_date = p_target_local_date;
  insert into public.today_v2_schedule_blocks(
    user_id, target_local_date, timezone_name, commitment_fragment_id, habit_definition_id, starts_at, ends_at
  )
  select v_user_id, p_target_local_date, p_timezone_name,
    b.commitment_fragment_id, b.habit_definition_id, b.starts_at, b.ends_at
  from jsonb_to_recordset(p_blocks) as b(
    commitment_fragment_id uuid, habit_definition_id uuid, starts_at timestamptz, ends_at timestamptz
  );
  return query select * from public.today_v2_schedule_blocks
  where user_id = v_user_id and target_local_date = p_target_local_date order by starts_at, id;
end;
$$;

create or replace function public.today_v2_archive_habit_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_archived and not old.is_archived then
    delete from public.today_v2_schedule_blocks b
    where b.user_id = new.user_id and b.habit_definition_id = new.id and b.starts_at >= now()
      and not exists (select 1 from public.today_v2_daily_reviews r
        where r.id = b.source_review_id and r.completed_at is not null)
      and not exists (select 1 from public.today_v2_daily_reviews r
        where r.user_id = b.user_id and r.local_date = b.target_local_date and r.completed_at is not null);
  end if;
  return new;
end;
$$;

revoke all on function public.today_v2_lock_source_review(uuid, date, text) from public, anon, authenticated;
revoke all on function public.today_v2_guard_schedule_review() from public, anon, authenticated;
revoke all on function public.today_v2_guard_plan_review() from public, anon, authenticated;
revoke all on function public.today_v2_replace_plan_stable_unlocked(date,date,text,text,text[],uuid[],text) from public, anon, authenticated;
revoke all on function public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text) from public, anon;
grant execute on function public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text) to authenticated;
notify pgrst, 'reload schema';
