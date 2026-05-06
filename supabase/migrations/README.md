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
