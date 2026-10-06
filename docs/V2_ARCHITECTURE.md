# Today V2 Architecture Boundaries

## Explicit route and feature switch
- `src/lib/featureFlags.js` is the single source of truth for `ENABLE_TODAY_V2`.
- `/app` is the authenticated generic entry point. It uses the existing V2 completion resolver: incomplete or unavailable completion metadata goes to `/today`; completed reviews go to `/home`.
- `/reflection` is a compatibility redirect to `/app`. Historical users can bookmark `/legacy/reflection`, which retains the AI dialogue and legacy persistence.
- Explicit `/today` always opens the structured nightly workflow, including its completed-review reopen/edit behavior; `/home` always opens the live checklist.
- Emergency rollback: set `VITE_ENABLE_TODAY_V2=false` and rebuild/redeploy. This changes only generic `/app` entry to `/legacy/reflection`; explicit V2 routes and user navigation remain available. Restore `true` to return generic entry to V2.
- User navigation is Today (`/home`), Review & Plan (`/today`), Progress (`/insights`), Settings (`/settings`). Administration remains separate.
- Progress currently uses the existing Insights implementation. Migrating its reporting data to V2 is separate work; this change does not merge legacy and V2 histories.

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
1. `/app` resolves the destination; explicit `/today` always opens Today V2.
2. `TodayV2Page` calls `useTodayV2State`.
3. `useTodayV2State` delegates all persistence to `src/v2/services/todayReview.js`.
4. The DAL reads/writes only `today_v2_*` tables and `today_v2_*` RPCs.
5. Commitment splitting happens in `src/shared/commitmentFragmentation.js`, then the resulting fragments are saved through `today_v2_replace_plan_for_date`.
6. `/legacy/reflection` keeps using `reflection_sessions` and related legacy objects without any shared writes.

## Schema/data-flow diagram (text)
```text
/app (ENABLE_TODAY_V2=true)
  -> completion resolver -> /home or /today
  /today
    -> TodayV2Page
      -> useTodayV2State
        -> todayReview DAL
          -> today_v2_seed_default_habits_for_user()
          -> today_v2_ensure_habit_occurrences_for_date()
          -> today_v2_* tables only

/reflection -> /app (compatibility)

/legacy/reflection (also /app rollback target when flag=false)
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

## Optional next-day scheduling and Google Calendar

Scheduling is V2-only and never changes a commitment's completion state. There
is no Calendar navigation tab, Google event writing, AI scheduling, or legacy
journal integration. `/today` and `/home` use the same
`today_v2_schedule_blocks` dataset.

### SQL → verification → deploy

Keep `VITE_ENABLE_TODAY_V2_SCHEDULER=false` (the default) until verification
passes. This is a build-time public feature switch, not a secret.

For an existing installation, copy/paste **the complete contents** of
`supabase/migrations/20261007_today_v2_scheduling.sql` into the Supabase SQL
Editor and run it. Apply the earlier `20260928_today_v2_workflow.sql` and
`20261006_today_v2_controllable_and_first_five.sql` migrations first if they
have not already been applied. For a fresh installation, copy/paste the complete
`supabase/sql/today_v2_isolated_workflow.sql` instead. Do not run superseded
generic V2 or legacy journal SQL. Neither path deletes historical check-ins.

Run these copy/paste verification queries **before deploying/enabling**:

```sql
select to_regclass('public.today_v2_schedule_blocks') as schedules,
       to_regclass('public.today_v2_google_connections') as connections,
       to_regclass('public.today_v2_google_oauth_states') as oauth_states;

select proname, pg_get_function_identity_arguments(oid) as arguments,
       prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('today_v2_replace_plan_stable',
                  'today_v2_replace_schedule',
                  'today_v2_consume_google_state');

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('today_v2_schedule_blocks',
                    'today_v2_google_connections',
                    'today_v2_google_oauth_states');

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.today_v2_schedule_blocks'::regclass
order by conname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('today_v2_google_connections',
                     'today_v2_google_oauth_states')
  and grantee in ('anon', 'authenticated');
```

Expect all three tables and RPCs to exist, all three tables to have RLS enabled,
schedule source exclusivity/time/ownership constraints and per-source date
uniqueness, and **zero** browser-role grants on the Google tables. Validate RLS
with two separate authenticated test accounts: direct foreign source UUIDs must
fail, not merely disappear from SELECT results. The SQL Editor's service role
does not simulate an authenticated browser.

Then deploy the app/API with the scheduler flag still false, configure Google
if wanted, and enable `VITE_ENABLE_TODAY_V2_SCHEDULER=true` in a subsequent
build after staging QA. Missing optional schema must not disable the core
review/Home workflow. Missing Google configuration leaves local scheduling
available with an explanatory connection message. Roll back the UI by setting
the scheduler switch false and rebuilding; leave the additive schema/data in
place.

### Stable source identity

The scheduler uses a separate V2 stable-plan RPC rather than the old order-based
plan reconciliation. An existing action is identified by its real fragment UUID,
not its list position; client draft keys are never persisted as fragment foreign
keys. Plan saving precedes schedule-reference saving, and the returned real rows
provide the IDs for new fragments. Explicit editing preserves identity and its
time; removing an unanswered action intentionally removes its schedule.
Re-splitting matches only unchanged, unambiguous actions, not unrelated text at
the same index. Answered-fragment overwrite protection remains in force.

Habit sources come from active definitions scheduled on the **target** weekday
(Sunday = 0 in storage; Monday first in display), not today's occurrences.
Archival excludes future active scheduling while keeping response history.
Absolute start/end timestamps are stored together with the planning date and
IANA timezone. Cross-midnight blocks are explicit; nonexistent DST wall times
are rejected and repeated wall times require an offset choice. Scheduling is an
editable 30-minute estimate by default, snapped to 15 minutes.
Each block belongs to its start date, even when it ends the following day;
crossing midnight does not create a second commitment, habit or completion row.

### Google Cloud manual setup

This setup requires a Google Cloud project owner; an agent cannot finish the
dashboard steps or verify production authorization without real credentials.

1. Enable **Google Calendar API** in Google Cloud's API Library.
2. Configure Google Auth Platform's branding, audience and consent screen.
   For an external app in Testing, add each real-account QA user as a test user.
   Review Google's sensitive-scope verification requirements before publishing;
   do not assume Testing consent or refresh-token lifetime equals production.
3. Create an OAuth client of type **Web application**, separate from any
   Supabase Google login client. This connects a calendar to the already signed-in
   Retaliate account, including email/password accounts; it does not change login.
4. Register the exact authorized redirect URI:
   - Development: `http://localhost:3000/api/google-calendar?action=callback`
     when running Vercel's local API server on port 3000.
   - Production: `https://YOUR_RETALIATE_HOST/api/google-calendar?action=callback`.
     Replace `YOUR_RETALIATE_HOST` with the actual deployment's canonical host;
     use exactly that URL for the environment variable too.
   - Register previews separately if needed; do not accept arbitrary preview
     hosts/return URLs dynamically. A Vite-only server on 5173 does not run the
     Vercel API; do not register its URL unless an actual API proxy is configured.
5. Authorized JavaScript origins, if configured, are `http://localhost:3000`
   and `https://YOUR_RETALIATE_HOST`, without paths. They do not replace redirect
   URI registration.
6. Request only these two read-only permissions:
   `https://www.googleapis.com/auth/calendar.events.readonly` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
   Do not add full Calendar, Google login or write scopes for this feature.

Official references (check current Google policy during deployment):
- [Calendar authorization scope reference](https://developers.google.com/workspace/calendar/api/auth)
- [OAuth 2.0 web-server authorization flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)

### Server environment and encryption

Set these **server-only** variables in Vercel and the local API environment:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Current project's Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only service role credential |
| `APP_ORIGIN` | Exact canonical app origin, e.g. `http://localhost:3000` |
| `GOOGLE_CALENDAR_CLIENT_ID` | Dedicated Web OAuth client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Dedicated OAuth client secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Exact registered callback above |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Base64-encoded, random 32-byte AES key |

Generate the encryption key with `openssl rand -base64 32`. Store it in a secret
manager/Vercel encrypted environment settings, never source control, frontend
configuration, logs or screenshots. Preserve a secure backup: losing/changing
the key makes saved credentials unreadable and requires reconnecting accounts.
For rotation, use a controlled backend decrypt/re-encrypt migration; simply
replacing the environment value is not transparent rotation. Separate production
and development keys/credentials. **Never prefix any server secret with
`VITE_`.**

Access/refresh tokens and PKCE verifiers are encrypted in backend-only storage;
OAuth state is short-lived and consumed once. The dedicated Calendar callback
is not a Supabase login/password-reset callback. Browser requests use verified
Retaliate bearer authentication; submitted account UUIDs are not authority.
Reconnect preserves an existing refresh token if Google omits a new one.
Disconnect removes stored credentials and attempts revocation without touching
local schedules.
Abandoned state is never accepted after expiry. Operators can periodically run
`delete from public.today_v2_google_oauth_states where expires_at <= now();`
as the backend/database owner to remove expired authorization rows. Browser
accounts must never receive table grants to perform this maintenance.

### Vercel constraints and event privacy

The integration uses one `api/google-calendar.js` serverless function with a
dedicated callback action. Ensure `/api/google-calendar` reaches the function
instead of the SPA fallback, including the `action=callback` query. Deploy both
API and frontend, not only static Vite output. Existing function memory/time
limits apply; calendar count, pagination and retries must remain bounded.
Some Vercel plans limit function count: the repository already has other API
functions, so verify the deployed plan's allowance before adding this endpoint.

Imports cover only the planner's bounded date window, expand recurring instances,
handle cancellation/pagination and preserve exclusive all-day end dates. Events
are muted read-only visibility, never commitments or completion evidence.
Descriptions and attendees are not needed or retained. Imported data is never
sent to AI services. Temporary browser-memory caching may become stale; refresh
on demand/resume, not with continuous polling. Quota/revocation/network failures
must leave the local planner usable and must not block nightly completion.

### Acceptance and remaining manual QA

Automated tests use mocked Google/Supabase integration; they are **not** evidence
of live Google consent, deployment permissions, or production connectivity.
Run the existing `npm run lint`, `npm test` and `npm run build` commands.
The transactional database regression suite is
`supabase/tests/today_v2_scheduling.sql`: run it with
`psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_scheduling.sql` against an
isolated migrated staging database as its owner. Its two fixed test users and
all assertions roll back; do not use a production database for fixture QA.
Before rollout, use actual development and production test accounts to verify:

- Desktop drag and keyboard/tap editing; phone touch hold/drag versus normal
  scrolling, moving, unscheduling, visible parallel overlaps and deliberate
  overlap approval.
- Tomorrow-only habits, Sunday/Monday boundaries, unsaved action edits,
  split → save → real IDs → schedule, reorder/edit/remove/re-split identity,
  archive with historical evidence preserved.
- Reload, interrupted/offline editing, visible failed saves, retry and completion
  waiting for local schedule changes; next-day Home times and check-ins.
- DST gap/repeated hours, timezone changes and cross-midnight blocks; Google
  recurring/cancelled/all-day/transparent and day-boundary-overlapping events.
- Email/password user connection without duplicate Retaliate accounts; two-user
  source/token access denial, expired/replayed/wrong-browser OAuth state,
  revoked authorization, refresh-token omission and disconnect.
- Multiple selected calendars and pagination; quota/network failure and stale
  display; core workflow with scheduler schema/configuration absent.

Desktop/phone screenshots from a mocked fixture demonstrate layout only; real
device and real-account QA remain required.
