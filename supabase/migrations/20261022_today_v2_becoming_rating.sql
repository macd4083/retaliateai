-- Optional daily self-reported progress. Existing owner RLS and the generic
-- completed-review update guard apply to this column without policy changes.
do $$
begin
  alter table public.today_v2_daily_reviews
    add column if not exists becoming_rating integer;

  if not exists (
    select 1 from pg_constraint
    where conname = 'today_v2_daily_reviews_becoming_rating_check'
      and conrelid = 'public.today_v2_daily_reviews'::regclass
  ) then
    alter table public.today_v2_daily_reviews
      add constraint today_v2_daily_reviews_becoming_rating_check
      check (becoming_rating is null or becoming_rating between 1 and 10);
  end if;

  notify pgrst, 'reload schema';
end $$;
