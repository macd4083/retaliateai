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
