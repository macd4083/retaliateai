# Supabase Migrations

These SQL files must be run manually in the Supabase Dashboard SQL Editor
(https://supabase.com/dashboard → your project → SQL Editor).

## Migrations (run in order)

1. `20260310_reflection_tables.sql` — Creates reflection_sessions, reflection_messages, reflection_patterns tables
2. `20260312_user_profiles_v2_columns.sql` — Adds V2 onboarding columns to user_profiles and why_it_matters to goals
