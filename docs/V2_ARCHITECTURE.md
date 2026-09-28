# V2 Architecture Boundaries

## Explicit switch
- `src/App.jsx` contains the single switch: `ENABLE_TODAY_V2` (from `VITE_ENABLE_TODAY_V2`).
- `/today` routes to:
  - **V2**: `src/v2/pages/TodayV2Page.jsx` when enabled.
  - **Legacy**: `src/pages/ReflectionV2.jsx` when disabled.
- `/reflection` and `/legacy/reflection` always serve the legacy reflection flow.

## V2 namespace
- `src/v2/pages/TodayV2Page.jsx`
- `src/v2/services/todayReview.js`

These V2 files may import shared utilities from `src/lib/*` (for example commitment splitting).

## Legacy namespace (unchanged behavior)
- Routes/pages: `src/pages/ReflectionV2.jsx`, `src/pages/InsightsV2.jsx`, `src/pages/SettingsV2.jsx`, `src/pages/OnboardingV2.jsx`, `src/pages/AdminV2.jsx`
- Shell/components: `src/components/v2/*`
- Existing services/hooks under `src/lib/*` and `src/hooks/*`

## V2 database objects
- `public.v2_daily_reviews`
- `public.v2_planned_actions`
- `public.v2_follow_through_items`
- `public.v2_habit_definitions`
- `public.v2_habit_logs`
- `public.seed_default_habits_for_user(p_user_id uuid)`

All V2 tables use RLS policies scoped to `auth.uid() = user_id`.

## SQL fallback for manual Supabase SQL editor run
Use migration file:
- `supabase/migrations/20260928_today_v2_workflow.sql`

## Weekly TODO stub (not implemented in build)
- Add weekly/monthly reports and graphs (commitment-kept rate, per-habit kept rate).
- Add Monday “strong start” treat.
- Add weekly review prompts:
  - consequences and benefits
  - trajectory and identity
