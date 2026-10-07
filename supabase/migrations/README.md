# Supabase Migrations

These SQL files must be run manually in the Supabase Dashboard SQL Editor
(https://supabase.com/dashboard → your project → SQL Editor).

Run files in filename order (alphabetical / chronological).

## Migrations (run in order)

1. `001_intelligent_coach.sql` — Initial schema: goals, reflection_sessions, reflection_messages, user_profiles, reflection_patterns
2. `20240311_add_profile_fields.sql` — Adds additional profile fields to user_profiles
3. `20250313_reflection_coach_columns.sql` — Adds reflection coach columns to reflection_sessions
4. `20260310_reflection_tables.sql` — Creates/updates reflection_sessions, reflection_messages, reflection_patterns tables
5. `20260312_user_profiles_trigger.sql` — Adds trigger to auto-create user_profiles on new auth user
6. `20260312_user_profiles_v2_columns.sql` — Adds V2 onboarding columns to user_profiles and why_it_matters to goals
7. `20260326_commitment_made_at.sql` — Adds made_at timestamp column to commitments
8. `20260327_goal_depth_fields.sql` — Adds depth insight fields to goals
9. `20260403_user_insights.sql` — Creates user_insights table for persisting generated pattern narratives
10. `20260403_user_insights_v2.sql` — Extends user_insights with additional narrative fields
11. `20260405_goal_commitment_log.sql` — Creates goal_commitment_log table for tracking per-commitment kept/missed outcomes (feeds motivation_signal)
12. `20260405_last_session_completed_at.sql` — Adds last_session_completed_at column to user_profiles
13. `20260405_verification_events.sql` — Creates verification_events table for cross-device email verification flow
14. `20260411_user_progress_events.sql` — Creates user_progress_events table for recording real threshold crossings; adds last_motivation_signal to goals
15. `20260412_consolidation_prereqs.sql` — Adds first_seen_date, last_seen_date, strength_evidence to user_insights; backfills from synthesized_at
16. `20260412_seed_whys_from_why_it_matters.sql` — Ensures whys column exists on goals; seeds whys[0] from why_it_matters for all goals that had it but no whys
17. `20260413_consolidate_why_it_matters.sql` — Drops the legacy goals.why_it_matters column (data already migrated to whys[] by migration 16)
18. `20260414_goal_baseline_and_commitment_outcome.sql` — Adds baseline_snapshot and baseline_date to goals; adds checkin_outcome to goal_commitment_log for storing explicit kept/missed/partial answers
19. `20260418_add_fragment_index.sql` — Adds fragment_index integer column to goal_commitment_log for ordering commitment fragments within a session
20. `20260420_add_goal_commitment_type.sql` — Adds commitment_type varchar column to goal_commitment_log
21. `20260428_add_commitment_type_to_goal_commitment_log.sql` — Ensures commitment_type text and fragment_index integer columns exist on goal_commitment_log (idempotent re-run of 19–20)
22. `20260429_session_causal_extracts.sql` — Creates session_causal_extracts table for storing win/miss cause raw text per session; used by synthesize-insights.js
23. `20260504_commitment_why.sql` — Adds commitment_why text column to goal_commitment_log; required for reflection-coach.js to persist fragment-level whys and for synthesize-insights.js to read them
24. `20260509_stripe_columns.sql` — Adds Stripe customer/subscription columns and trial fields to user_profiles
25. `20260609_fix_trial_start.sql` — Ensures trial default behavior on signup and backfills missing trial_ends_at for trialing users
26. `20260609_user_feedback.sql` — Creates user_feedback table and adds feedback/trial email tracking columns to user_profiles

## Today V2 scheduling: deployment checklist

- Apply `20260928_today_v2_workflow.sql`, `20261006_today_v2_controllable_and_first_five.sql`, `20261007_today_v2_scheduling.sql`, `20261008_today_v2_schedule_review_lock.sql`, then the additive [`20261009_today_v2_completion_release_guard.sql`](20261009_today_v2_completion_release_guard.sql) before deploying the scheduler. It now defaults enabled; use the exact value `VITE_ENABLE_TODAY_V2_SCHEDULER=false` only for an emergency rollback. Apply the additive guard even if the earlier scheduling/repair migrations are already marked applied. The SQL Editor alternative is `supabase/sql/today_v2_isolated_workflow.sql`, containing the same migrations in order.
- The repair and additive guard are atomic and repeatable: the repair backfills owned source reviews without changing historical schedules; the guard locks review fields and checklist responses against completion. Reopening restores edits. Global habit definitions can still change for future days; completed-day snapshots and schedule evidence remain protected. Completed-day reloads do not create new habit snapshots.
- Run all three `supabase/tests/today_v2_*.sql` scripts as database owner on an isolated test database with `psql -v ON_ERROR_STOP=1`; they roll back their fixtures. The upgrade test restores the original scheduling schema within its transaction and checks archived/weekday-changed historical habits.
- Verify the deployed repair (expect zero missing owners, six enabled lock triggers, and `false` for direct access to the unlocked implementation):

```sql
select count(*) as missing_schedule_owners
from public.today_v2_schedule_blocks b
left join public.today_v2_daily_reviews r on r.id = b.source_review_id and r.user_id = b.user_id
where r.id is null;

select tgname, tgenabled from pg_trigger
where tgrelid in ('public.today_v2_daily_reviews'::regclass,
  'public.today_v2_plan_inputs'::regclass, 'public.today_v2_commitment_fragments'::regclass,
  'public.today_v2_habit_occurrences'::regclass, 'public.today_v2_schedule_blocks'::regclass)
and tgname in ('today_v2_completed_review_lock', 'today_v2_plan_review_lock',
  'today_v2_fragment_review_lock', 'today_v2_fragment_outcome_review_lock',
  'today_v2_habit_outcome_review_lock', 'today_v2_schedule_review_lock');

select has_function_privilege('authenticated',
  'public.today_v2_replace_plan_stable_unlocked(date,date,text,text,text[],uuid[],text)',
  'EXECUTE') as browser_can_bypass_review_lock;
```

## Daily review reminders: deployment checklist

- Deploy the V2 review schema before enabling reminders. Missed-review email eligibility uses only `today_v2_daily_reviews.completed_at`, never legacy sessions: two missed review days, a prior completed review, and a seven-day email cooldown. Query failures suppress delivery.
- Set server-only `CRON_SECRET` in Vercel. Both email cron endpoints and direct/broadcast push requests require its Authorization bearer header; an unset secret disables delivery. The existing `vercel.json` email schedules remain unchanged, and Vercel attaches the configured cron authorization automatically.
- Set `PUBLIC_APP_ORIGIN` to your canonical HTTP(S) origin; the default is `https://retaliateai.com`, verified against the sitemap. Email and checkout links never use a request Host header. Review reminders open `/today`, trial/payment app links open `/app`, and upgrade/billing links open `/settings`.
- Missed-review email dates use the most recently completed V2 review's `timezone_name` (the browser timezone actually used by V2), avoiding stale profile defaults; invalid/missing review timezones are skipped. Push schedules use the profile's chosen reminder `timezone`. Both use `VITE_TODAY_V2_DAY_BOUNDARY_HOUR` (default **4 AM**) matching the V2 deployment setting. Browser-only `today_v2_day_boundary_hour` localStorage overrides are not available to server jobs; no new persisted preference is introduced. A timezone changed after the last completed review, or a browser timezone different from the push preference, may still produce different review-day boundaries.
- Enable Supabase `pg_cron`, `pg_net`, and Vault. Provision the Vercel environment variables and matching Vault secrets named `public_app_origin` and `cron_secret` first, then run **`add_nightly_push_cron.sql`** against the existing endpoint, verify the named job, and only then deploy the authenticated endpoints. It updates only the named minute job in place and never deletes application data. The existing push endpoint ignores the added authorization header; the new endpoint requires it. Its SQL includes job and HTTP-response verification queries; verify HTTP 200 after deployment without displaying secret values.
