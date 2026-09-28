# Today V2 Architecture Boundaries

## Explicit route and feature switch
- `src/lib/featureFlags.js` is the single source of truth for `ENABLE_TODAY_V2`.
- `src/App.jsx` uses that flag to choose the `/today` route target:
  - **V2**: `src/v2/pages/TodayV2Page.jsx`
  - **Legacy**: `src/pages/ReflectionV2.jsx`
- `/reflection` and `/legacy/reflection` always remain on legacy persistence.
- `src/components/v2/AppShellV2.jsx` reads the same shared flag only for navigation labels; it does not change persistence.

## Boundary map

### Today V2-only client modules
- Route/UI: `src/v2/pages/TodayV2Page.jsx`
- State hook: `src/v2/today/useTodayV2State.js`
- Data-access layer: `src/v2/services/todayReview.js`
- V2 types/constants: `src/v2/today/types.js`
- V2 pure helpers: `src/v2/today/model.js`

### Pure shared utility allowed across legacy and V2
- `src/shared/commitmentFragmentation.js`
  - Pure text splitting only
  - No Supabase imports
  - No legacy table names, hooks, stores, or RPC names
- `src/lib/commitmentFragments.js`
  - Legacy-compatible wrapper that now reuses the neutral splitter

### Legacy-only persistence modules
- `src/pages/ReflectionV2.jsx`
- `src/lib/supabase/reflection.js`
- Legacy tables such as `reflection_sessions`, `reflection_messages`, `follow_up_queue`, `growth_markers`, and `goal_commitment_log`

## Persistence boundary
Today V2 uses the public-prefix fallback so no extra Supabase API schema configuration is required.

### Today V2 tables
- `public.today_v2_daily_reviews`
- `public.today_v2_plan_inputs`
- `public.today_v2_commitment_fragments`
- `public.today_v2_habit_definitions`
- `public.today_v2_habit_occurrences`

### Today V2 RPCs/functions
- `public.today_v2_seed_default_habits_for_user(p_user_id uuid)`
- `public.today_v2_ensure_habit_occurrences_for_date(p_local_date date, p_timezone_name text)`
- `public.today_v2_replace_plan_for_date(...)`
- `public.today_v2_touch_updated_at()`

### Superseded SQL/RPCs that should **not** be run for Today V2
These generic objects are replaced by the isolated Today V2 schema and should not be used for the new workflow:
- `public.seed_default_habits_for_user(...)`
- `public.replace_v2_planned_actions(...)`
- `public.v2_daily_reviews`
- `public.v2_planned_actions`
- `public.v2_follow_through_items`
- `public.v2_habit_definitions`
- `public.v2_habit_logs`

## Data flow
1. `/today` resolves through `ENABLE_TODAY_V2`.
2. `TodayV2Page` calls `useTodayV2State`.
3. `useTodayV2State` delegates all persistence to `src/v2/services/todayReview.js`.
4. The DAL reads/writes only `today_v2_*` tables and `today_v2_*` RPCs.
5. Commitment splitting happens in `src/shared/commitmentFragmentation.js`, then the resulting fragments are saved through `today_v2_replace_plan_for_date`.
6. Legacy routes keep using `reflection_sessions` and related legacy objects without any shared writes.

## Schema/data-flow diagram (text)
```text
ENABLE_TODAY_V2
  -> /today route
    -> TodayV2Page
      -> useTodayV2State
        -> todayReview DAL
          -> today_v2_seed_default_habits_for_user()
          -> today_v2_ensure_habit_occurrences_for_date()
          -> today_v2_* tables only

/reflection
  -> ReflectionV2
    -> legacy reflectionHelpers
      -> reflection_sessions + legacy tables only
```

## Table responsibilities
### `today_v2_daily_reviews`
One row per user and local date for V2 review metadata and the `Who am I actively becoming?` response.

### `today_v2_plan_inputs`
Raw plan input for a target local date. Stores the paragraph before fragmentation, with source date, target date, timezone, and parser version.

### `today_v2_commitment_fragments`
Append-safe fragment rows for follow-through:
- one row per fragment order per target local date
- independent `completion_state`: `unanswered`, `kept`, `not_kept`
- `answered_at` separates unanswered from answered history
- plan edits may replace only unanswered fragments; once any fragment is answered, replacement is rejected to preserve history

### `today_v2_habit_definitions`
Per-user habit definitions with stable UUIDs, response type, optional unit, weekday schedule, display order, and archive state.

### `today_v2_habit_occurrences`
Materialized daily habit checklist rows with immutable snapshots:
- local date + timezone name
- scheduled weekday
- snapshot name/type/unit/display order
- boolean or numeric response
- `answered_at` distinguishes unanswered from explicit `false`
- historical meaning survives later definition edits or archival

## Failure handling
- Default seeding is optional. If `today_v2_seed_default_habits_for_user` is absent or fails, Today V2 still renders with an empty/addable habit state and a non-blocking diagnostic.
- Real load errors still show retry UI.
- PostHog/ad blockers do not gate page loading because analytics calls are already wrapped defensively.

## Data dictionary for future reporting
### Commitment kept rate
Numerator:
- count of `today_v2_commitment_fragments` where `completion_state = 'kept'`

Denominator:
- count of `today_v2_commitment_fragments` where `completion_state in ('kept', 'not_kept')`

Notes:
- Exclude `unanswered` fragments from the denominator when reporting an answered kept rate.
- Use `target_local_date` for daily/weekly/monthly buckets.
- Because each fragment is stored separately, one paragraph can produce multiple independently scored commitments.

### Per-habit completion/kept rate
For boolean habits:
- Numerator: `today_v2_habit_occurrences.boolean_response = true`
- Denominator: rows with `answered_at is not null`

For numeric habits:
- Completion rate denominator: rows with `answered_at is not null`
- Completion rate numerator: same as denominator when measuring answered completion
- Value aggregates: use `avg(numeric_response)`, `sum(numeric_response)`, or thresholded comparisons depending on future report design

History rules:
- Use occurrence snapshot fields (`snapshot_name`, `snapshot_response_type`, `snapshot_unit`) when labeling old rows.
- Archived habits stay in historical reports because occurrences are not deleted.
- Future scheduled rows exclude archived definitions because occurrence creation only uses active habits.

## Deployment files
- Timestamped migration: `supabase/migrations/20260928_today_v2_workflow.sql`
- SQL Editor copy/paste file: `supabase/sql/today_v2_isolated_workflow.sql`

## Deployment order
1. Run `supabase/sql/today_v2_isolated_workflow.sql` in Supabase SQL Editor.
2. Wait for `notify pgrst, 'reload schema';` to refresh the schema cache.
3. Deploy the app code using the new Today V2 client modules.
4. Open `/today` with `ENABLE_TODAY_V2=true` and verify habits can still be added manually even if default seeding is unavailable.
