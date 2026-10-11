# Today V2 Architecture Boundaries

## Explicit routes and scheduler feature switch
- `src/lib/featureFlags.js` retains only the independent `ENABLE_TODAY_V2_SCHEDULER` switch.
- `/app` is the authenticated generic entry point. It uses the existing V2 completion resolver: incomplete or unavailable completion metadata goes to `/today`; completed reviews go to `/home`.
- `/reflection` and `/legacy/reflection` are compatibility redirects to `/app`. The legacy coaching page and its endpoints are retired.
- Explicit `/today` always opens the structured nightly workflow, including its completed-review reopen/edit behavior and ROI action checklist. `/home` opens Today with a read-only calendar of actions and habits, plus habit check-ins; ROI completion is recorded only in Review & Plan.
- `VITE_ENABLE_TODAY_V2` is retired and ignored. Generic entry cannot roll back to the removed AI dialogue; legacy bookmarks always use the live V2 resolver.
- User navigation is Today (`/home`), Review & Plan (`/today`), Progress (`/insights`), Settings (`/settings`). Administration remains separate.
- Progress currently uses the existing Insights implementation. Migrating its reporting data to V2 is separate work; this change does not merge legacy and V2 histories.
- Both pages reuse `TomorrowScheduler`. A missing scheduling schema or connection disables editing and shows diagnostics without hiding the calendar; an invalid date/timezone still prevents timeline rendering. Unscheduled actions remain visible in the calendar's tray. Today uses the review-day date, with separate civil-day schedule context after midnight.

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

### Retained legacy persistence and reporting
- `src/lib/supabase/reflection.js`
- Legacy tables such as `reflection_sessions`, `reflection_messages`, `follow_up_queue`, `growth_markers`, and `goal_commitment_log`
- Progress, commitment statistics, administration and guest signup transfer still use historical data. All database history and migrations remain untouched.
- `src/pages/ReflectionV2.jsx`, the `reflection-coach`, `goals`, and `synthesize-insights` API endpoints, and their end-to-end simulator are removed; unrelated legacy helpers are retained.

## Persistence boundary
Today V2 uses the public-prefix fallback so no extra Supabase API schema configuration is required.

### Today V2 tables
- `public.today_v2_daily_reviews`
- `public.today_v2_plan_inputs`
- `public.today_v2_commitment_fragments`
- `public.today_v2_habit_definitions`
- `public.today_v2_habit_occurrences`
- `public.today_v2_schedule_blocks`
- `public.today_v2_habit_schedule_overrides`

### Today V2 RPCs/functions
- `public.today_v2_seed_default_habits_for_user(p_user_id uuid)`
- `public.today_v2_ensure_habit_occurrences_for_date(p_local_date date, p_timezone_name text)`
- `public.today_v2_seed_habit_schedules(p_start_local_date date, p_end_local_date date, p_timezone_name text)`
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
6. `/legacy/reflection` redirects to `/app`; historical reporting still reads legacy objects without merging them into V2.

## Schema/data-flow diagram (text)
```text
/app
  -> completion resolver -> /home or /today
  /today
    -> TodayV2Page
      -> useTodayV2State
        -> todayReview DAL
          -> today_v2_seed_default_habits_for_user()
          -> today_v2_ensure_habit_occurrences_for_date()
          -> today_v2_* tables only

/reflection, /legacy/reflection -> /app (compatibility)

Progress / historical reporting
  -> legacy reflectionHelpers
    -> reflection_sessions + legacy tables only
```

## Table responsibilities
### `today_v2_daily_reviews`
One row per user and local date for V2 review metadata and the `Who am I actively becoming?` response.
Desired Direction edits autosave and replace that day's response, whether typed manually or populated with Autofill. Autofill uses the current saved response, falling back to the latest nonempty prior review; it does not overwrite a new day's answer automatically. The retired 5.2 question is no longer displayed, but its historical data remains intact.

### `today_v2_plan_inputs`
Raw plan input for a target local date. Stores the paragraph before fragmentation, with source date, target date, timezone, and parser version.
Identity Alignment captures tomorrow's actions. The `first_five_minutes` field stores each action's start on a separate line, in action order. Calendar drag items display a concise `action, start` label, falling back to the action alone when its start is missing; blank lines preserve positional alignment.

### `today_v2_commitment_fragments`
Append-safe fragment rows for follow-through:
- one row per fragment order per target local date
- independent `completion_state`: `unanswered`, `kept`, `not_kept`
- `answered_at` separates unanswered from answered history
- plan edits may replace only unanswered fragments; once any fragment is answered, replacement is rejected to preserve history

### `today_v2_habit_definitions`
Per-user habit definitions with stable UUIDs, response type, optional unit, weekday schedule, display order, and archive state.

Habit editing includes a compact weekly calendar. Day headers select recurrence
days; the calendar snaps placement to 15-minute increments, while time and
duration fields support exact minute values. `schedule_times` stores each
weekday's local time, duration, and earlier/later daylight-saving occurrence.
`planning_mode` distinguishes habits offered for manual daily planning from
habits automatically placed at those recurring times. A daily time adjustment
does not change the recurring definition.

Deploy `supabase/migrations/20261010_today_v2_habit_recurrence.sql` after the
existing scheduling migrations through
`20261009_today_v2_completion_release_guard.sql` before using recurring times.
The complete SQL Editor installation file also includes this migration.

Automatic times are materialized into the same daily schedule used by `/home`.
Per-day overrides preserve dragged, edited, or unscheduled occurrences across
reloads without changing the weekly rule. Recurrence skips nonexistent DST
times and uses the configured earlier/later occurrence for repeated times.
Missing automatic occurrences can appear on an open target day even after the
previous review is completed; existing completed-source plans and completed
target days remain unchanged.

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
4. Open `/today` and verify habits can still be added manually even if default seeding is unavailable.

## Optional next-day scheduling and Google Calendar

Scheduling is V2-only and never changes a commitment's completion state. There
is no Calendar navigation tab, automatic Google commitment export, AI scheduling, or legacy
journal integration. `/today` and `/home` use the same
`today_v2_schedule_blocks` dataset.

The planning timeline is taller on both mobile and desktop. Cards can be
dragged onto the pointer's time, snapped to the nearest 15 minutes, including
over existing events. On touch screens, long-press the drag handle to preserve
normal page scrolling. Clicking a card opens exact-time editing; overlapping
placements still require explicit confirmation. Workflow action and start-focus
labels update as the answers are edited, without refreshing the page.

### SQL → verification → deploy

To hold the rollout until verification passes, explicitly set
`VITE_ENABLE_TODAY_V2_SCHEDULER=false`; the current default is enabled.
This is a build-time public feature switch, not a secret.

For an existing V2 installation (including one where Calendar SQL has never
been run), or a fresh installation, copy/paste **the complete contents** of
`supabase/sql/today_v2_isolated_workflow.sql` into the Supabase SQL Editor.
This is the single complete installation/repair file; do not assemble fragments.
It includes the base V2 workflow, controllable/first-five fields, Calendar schema
and source-review locking repair. It does not drop user tables or historical
check-ins. Execute the complete file as one transaction; for `psql`, use
`psql --single-transaction -v ON_ERROR_STOP=1 -f supabase/sql/today_v2_isolated_workflow.sql`.
Do not execute selected lines individually. Run it in staging first and verify
below.

For installations managed by timestamped migrations, the ordered prerequisites
are `20260928_today_v2_workflow.sql`,
`20261006_today_v2_controllable_and_first_five.sql`,
`20261007_today_v2_scheduling.sql`, then the new
`20261008_today_v2_schedule_review_lock.sql`. Do not edit/reapply old migration
history as a substitute for the repair. Do not run superseded generic V2 or
legacy journal SQL. Migration runners must wrap the repair in a transaction
(use `--single-transaction -v ON_ERROR_STOP=1` when applying it with `psql`).

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
                  'today_v2_consume_google_state',
                  'today_v2_finish_google_authorization');

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

select column_name, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'today_v2_schedule_blocks'
  and column_name = 'source_review_id';

select count(*) as orphaned_or_foreign_source_reviews
from public.today_v2_schedule_blocks b
left join public.today_v2_daily_reviews r
  on r.id = b.source_review_id and r.user_id = b.user_id
where r.id is null;

select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid in ('public.today_v2_schedule_blocks'::regclass,
                 'public.today_v2_plan_inputs'::regclass,
                 'public.today_v2_commitment_fragments'::regclass)
  and not tgisinternal and tgname like '%review_lock';

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('today_v2_google_connections',
                     'today_v2_google_oauth_states')
  and grantee in ('anon', 'authenticated');
```

Expect all three tables and four RPCs to exist, all three tables to have RLS enabled,
schedule source exclusivity/time/ownership constraints and per-source date
uniqueness, a non-null owned `source_review_id` with zero orphaned/foreign rows,
review-lock triggers on schedules/plans/fragments, and **zero** browser-role
grants on the Google tables. Schedule writes and review completion lock the same
source review row; completing tomorrow's checklist remains a separate operation.
Validate RLS
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
are rejected and repeated wall times require an offset choice. Scheduling uses
an editable 30-minute estimate by default (or the habit's weekday duration).
Dragging snaps starts to 15 minutes; exact-time editing accepts any minute and
durations from 1 to 1440 minutes.
Each block belongs to its start date, even when it ends the following day;
crossing midnight does not create a second commitment, habit or completion row.
Its source review owns editability, not the target day's checklist. Timeline
dates are civil midnight-to-midnight in the displayed timezone; the nightly
review/checklist still follows the separate 04:00 boundary. Home labels its civil
schedule date separately when these differ. Carryover is read-only context,
clipped to the visible day, with its original source/date retained. Durations are
elapsed minutes: a 24-hour estimate around spring-forward can span two civil
date boundaries without creating another commitment.

### Google Cloud manual setup

This setup requires a Google Cloud project owner; an agent cannot finish the
dashboard steps or verify production authorization without real credentials.

1. Enable **Google Calendar API** in Google Cloud's API Library.
2. Configure Google Auth Platform's branding, audience and consent screen.
   For an external app in Testing, add each real-account QA user as a test user.
   Review Google's sensitive-scope verification requirements before publishing;
   do not assume Testing consent or refresh-token lifetime equals production.
   External Testing grants using these Calendar scopes generally have seven-day
   refresh-token lifetimes; expect reconnect prompts during prolonged QA.
3. Create an OAuth client of type **Web application**, separate from any
   Supabase Google login client. This connects a calendar to the already signed-in
   Retaliate account, including email/password accounts; it does not change login.
4. Register the exact authorized redirect URI:
   - Development: `http://localhost:3000/api/google-calendar?action=callback`
     when running Vercel's local API server on port 3000.
   - Production: `https://retaliateai.com/api/google-calendar?action=callback`,
     matching this repository's canonical-domain intent in `public/sitemap.xml`.
     Set `APP_ORIGIN=https://retaliateai.com` and use exactly that callback for
     `GOOGLE_CALENDAR_REDIRECT_URI`. If the deployment uses a different canonical
     host, explicitly register and configure its matching callback instead.
   - Register previews separately if needed; do not accept arbitrary preview
     hosts/return URLs dynamically. A Vite-only server on 5173 does not run the
     Vercel API; do not register its URL unless an actual API proxy is configured.
5. Authorized JavaScript origins, if configured, are `http://localhost:3000`
   and `https://retaliateai.com`, without paths. They do not replace redirect
   URI registration.
6. Request only these two permissions:
   `https://www.googleapis.com/auth/calendar.events` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
   Do not add full Calendar, calendar-management, ACL, or Google login scopes.
   Existing read-only grants must reconnect to upgrade event permissions.
   See [event management rollout](CALENDAR_SCHEDULER_RELEASE.md#google-event-management-rollout)
   for write restrictions, resize behavior, and owner smoke tests.

Official references (check current Google policy during deployment):
- [Calendar authorization scope reference](https://developers.google.com/workspace/calendar/api/auth)
- [OAuth 2.0 web-server authorization flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Refresh-token expiration, including external Testing](https://developers.google.com/identity/protocols/oauth2#expiration)

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
Successful authorization consumes state and stores encrypted credentials in
one database transaction. Disconnect invalidates pending state before deleting
credentials, so an authorization-code exchange already in flight cannot
silently recreate a disconnected connection.
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
Use a supported Vercel Node runtime with native `fetch` and
`AbortSignal.timeout` (Node 20 or newer). For local OAuth/API QA, use the Vercel
CLI's `vercel dev --listen 3000` with the server variables above; `npm run dev`
alone serves the frontend, not the Calendar API.
Retiring the three obsolete coaching endpoints leaves 10 deployable JavaScript
API functions, below Vercel Hobby's 12-function limit. Working Calendar, billing,
feedback, statistics and administration endpoints remain. Successful Hobby
deployment is unverified; a successful Vite build alone does not establish
deployment success or diagnose the earlier failed deployments.

Imports cover only the planner's bounded date window, expand recurring instances,
handle cancellation/pagination and preserve exclusive all-day end dates. Events
are external events, never commitments or completion evidence. Writable supported
events can be edited or deleted; read-only events remain non-editable overlays.
Descriptions and attendees are not needed or retained. Imported data is never
sent to AI services. Temporary browser-memory caching may become stale; refresh
on demand/resume, not with continuous polling. Quota/revocation/network failures
must leave the local planner usable and must not block nightly completion.

### Acceptance and remaining manual QA

Automated tests use mocked Google/Supabase integration; they are **not** evidence
of live Google consent, deployment permissions, or production connectivity.
Run the existing `npm run lint`, `npm test` and `npm run build` commands.
The transactional database regression suites are
`supabase/tests/today_v2_scheduling.sql` and
`supabase/tests/today_v2_schedule_review_lock.sql`, plus the rollback-only upgrade
test `supabase/tests/today_v2_schedule_review_upgrade.sql`: run them with
`psql -v ON_ERROR_STOP=1 -f supabase/tests/today_v2_scheduling.sql -f supabase/tests/today_v2_schedule_review_lock.sql -f supabase/tests/today_v2_schedule_review_upgrade.sql` against an
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

- [Desktop planner screenshot](screenshots/schedule-tomorrow-desktop.png)
- [Phone planner screenshot](screenshots/schedule-tomorrow-phone.png)

Prior implementation Chromium fixture checks exercised tap scheduling, overlap confirmation, time
editing and unscheduling, and confirmed no horizontal page overflow at 390px.
Google responses were mocked; real touch-drag, OAuth consent and next-day
production behavior still need the manual checks above.

### Repair evidence and owner rollout checklist (2026-10-07)

The accessible GitHub Vercel status on PR #359 is **failure**, with deployment
`dpl_GdW1ekMrPjDEdUUgQBMPYZzdfFr1`:
[failed deployment](https://vercel.com/matt-macdonalds-projects/retaliateai/GdW1ekMrPjDEdUUgQBMPYZzdfFr1).
The status provides `npx vercel inspect dpl_GdW1ekMrPjDEdUUgQBMPYZzdfFr1 --logs`,
but not the command/error that failed. The Vercel page is inaccessible from the
repair sandbox; no dashboard credentials are available. GitHub Actions contains
no failed job log for the prior agent run (it was cancelled). **Deployment root
cause remains unestablished.** No endpoint removal, plan upgrade or deployment
success is claimed.

The first repair checkpoint (`1e673937c7d03cb155a8c09782f37282a3f93856`)
also received a failed Vercel status at 2026-10-07 01:58 UTC:
`dpl_93WXHyZiuCSJtLftppjbt8KHCCZR`
([deployment](https://vercel.com/matt-macdonalds-projects/retaliateai/93WXHyZiuCSJtLftppjbt8KHCCZR)).
Its exact failing command/error is likewise not exposed by the status. The new
[Scheduler validation run](https://github.com/macd4083/retaliateai/actions/runs/37559663134)
is `action_required`, with zero jobs/logs; it is not a test failure or a successful
CI run. Owner approval is required.

Local Node 22.23.3 / npm 10.9.9: clean `npm ci` exited 0 (32 seconds);
separate `npm run build` exited 0 (Vite 6.47 seconds plus PWA generation).
Lockfile installation is consistent. Warnings include existing bundle size,
stale Browserslist data and dependency audit findings (58); dependencies were
not broadly upgraded as part of this repair. API regressions exercise the actual
unconfigured handler's JSON response, callback/status rewrite exclusions and
browser/server import isolation. They do not simulate Vercel's deployed router
or serverless bundler.

Typecheck on an untouched `git archive HEAD` of the starting branch exited 2,
with 232 diagnostics (11.61 seconds), including Stripe types, web-push and
existing JavaScript inference errors. Those are a recorded baseline, not silently
skipped or evidence of a Vercel failure. The CI workflow
`.github/workflows/scheduler-validation.yml` checks clean install, focused
scheduler/Calendar/deployment tests, production build and migration upgrade /
idempotent repair on disposable PostgreSQL with minimal Supabase auth fixtures.

PostgreSQL 16.15 is locally available. Tests use a disposable cluster with minimal
Supabase `auth.users`, `auth.uid()` and browser/service roles, not a live project.
Baseline V2 → Calendar migration upgrade and the transactional scheduling/OAuth
SQL suite exited 0. This establishes PostgreSQL behavior, not full hosted
Supabase/PostgREST or live Google integration.

To reproduce the common review lock, use **two separate `psql` sessions against
a disposable migrated database only**. In session A, set up a temporary fixture:

```sql
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000991');
insert into public.today_v2_daily_reviews(user_id, local_date, timezone_name)
values ('00000000-0000-4000-8000-000000000991', '2099-07-01', 'UTC');
begin;
update public.today_v2_daily_reviews set completed_at = now()
where user_id = '00000000-0000-4000-8000-000000000991' and local_date = '2099-07-01';
```

In session B:

```sql
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000991', false);
select public.today_v2_replace_schedule('2099-07-02', 'UTC', '[]'::jsonb);
```

B must wait, not succeed while A holds the review row. Run `commit;` in A:
B must then reject with `Source review is completed; reopen it before editing`.
Reopen in A (`update ... set completed_at = null` with the same user/date
predicate). For the reverse ordering, A begins a transaction, sets the same JWT
subject and calls the schedule RPC; B's completion UPDATE must wait until A
commits. Finally, as database owner, remove only this disposable fixture:
`delete from auth.users where id = '00000000-0000-4000-8000-000000000991';`.
The automated rollback suites separately exercise action/habit mutations,
direct DML denial, ownership, reopen, and next-day outcome permissions.

The repair session's Playwright service failed with `Transport closed`; **no new
browser/device screenshots, drag/reload or 390px QA were verified in this
session**. Linked screenshots above belong to the prior implementation.

| Command/check | Duration | Exit/result | Evidence level |
| --- | --- | --- | --- |
| `npm ci` | 32s | 0 | Clean local installation |
| `npm run build` (before repair) | Vite 6.47s + PWA | 0 | Local build, not Vercel deployment |
| `npm run test -- src/__tests__/schedulerDeployment.test.js` | 0.89s | 0; 3 tests | API import/JSON, rewrite and browser isolation regressions |
| `npm test -- src/__tests__/googleCalendar.test.js` | Vitest 0.886s; ~1s wall | 0; 69 tests | Mocked backend/OAuth/security regressions |
| `npm test -- src/__tests__/googleCalendarConnectionUi.test.jsx` | Vitest 2.34s; ~3s wall | 0; 33 tests | Mocked picker, selection, account/date races and recovery |
| `npm test -- src/__tests__/todayV2Scheduling.test.js` | 2.317s | 0; 12 tests | Civil dates, midnight/DST and stable identity model |
| `npm test -- src/__tests__/tomorrowSchedulerUi.test.jsx` | 4.615s | 0; 40 tests | jsdom editor, drag callbacks, locks and carryover |
| `npm test -- src/__tests__/schedulerHomeUi.test.jsx` | 2.688s | 0; 11 tests | jsdom Home carryover/civil-date/checklist separation |
| `npm run lint` (initial snapshot) | 10.29s | 0 | Local lint |
| `npm run typecheck` (untouched starting branch archive) | 11.61s | 2; 232 diagnostics | Pre-existing baseline |
| Baseline V2/Calendar migrations + `supabase/tests/today_v2_scheduling.sql` | Not timed | 0 | Disposable PostgreSQL 16, transactional/RLS/OAuth tests |
| Real concurrent PostgreSQL completion/schedule sessions | 6.847s | 0; expected blocked writes then rejections/success | Actual `Lock` waits and `pg_blocking_pids`, not mocks |
| Vercel deployment `dpl_GdW1ekMrPjDEdUUgQBMPYZzdfFr1` | Unknown | Failed status; exact error inaccessible | Not locally reproduced; owner logs required |
| Repair checkpoint Vercel `dpl_93WXHyZiuCSJtLftppjbt8KHCCZR` | Unknown | Failed status; exact error inaccessible | Deployment still unresolved |
| GitHub Scheduler validation run `37559663134` | N/A | `action_required`; zero jobs | Owner approval required; no CI pass claimed |
| Browser QA in this repair session | N/A | Tool unavailable | Unverified, no new screenshots |

Owner actions, in order:

1. Approve the new Scheduler validation workflow in GitHub Actions. Open the
   latest failed deployment's build logs (or run
   `npx vercel inspect dpl_93WXHyZiuCSJtLftppjbt8KHCCZR --logs`
   while authenticated to the correct Vercel team). Record the first failed
   command, exact error, Node version and referenced file/line. Check project
   root, install/build command and environment scope against this repository.
   Only if logs identify a plan/runtime/bundling limitation, address that
   specific setting; do not delete email, billing or auth routes speculatively.
2. In a disposable Supabase staging project apply the **complete consolidated
   SQL file** above, then run verification queries and SQL regression tests.
   Apply required SQL to the intended project only after backup/change approval.
   Deployment order is **required SQL → verify → deploy with scheduler disabled
   → staging QA → enable scheduler flag and rebuild**.
3. Confirm the actual production canonical host in Vercel Domains. Repository
   intent is `https://retaliateai.com`, not live dashboard verification. For that
   host, register exactly
   `https://retaliateai.com/api/google-calendar?action=callback`; set matching
   `APP_ORIGIN` and `GOOGLE_CALENDAR_REDIRECT_URI`. Use separately registered
   dev/preview clients/origins and never arbitrary redirect wildcards.
4. Complete the Google Cloud steps above: Calendar API, branding/audience/test
   users, dedicated Web client and the two scopes listed above. Set all seven
   server variables in the correct Vercel environment; preserve the encryption
   key if connections already exist. Check current official verification policy
   before publishing publicly. Redeploy after environment changes.
5. On the deployed origin, request `/api/google-calendar?action=status` without
   authentication: expect JSON 401, never `index.html`. Signed-in status with
   Google unconfigured should explain unavailability without breaking Today/Home.
   Run actual connect/cancel/reconnect from Today and Settings in the same
   browser; a callback in another browser must reject state. Diagnose
   `redirect_uri_mismatch` by exact URI equality, `invalid_state` by
   cookie/browser/expiry, and `storage_unavailable` by schema/RPC/grants.
6. With a test Google account verify multi-calendar and empty selection survive
   reload, revoked/removed calendars disclose unavailable context, and
   disconnect/signout clear overlays but preserve local schedules. Testing-mode
   refresh tokens can expire after seven days; reconnect, not key rotation, is
   the recovery. Never copy credentials, event payloads or tokens into logs/AI.
7. At desktop and approximately 390px, verify actual drag, tap, keyboard,
   touch-scroll/activation and modal focus return; reload after saving.
   Complete with an editor open and a write pending, test failed persistence,
   reopen, then check next-day outcomes and read-only midnight carryover.
   Repeat on a real iPhone/browser/installed PWA, including OAuth returning to
   the original browsing context. These require owner/account/device access.

Implemented and mocked-tested features, disposable PostgreSQL-tested behavior,
deployed behavior and owner-only QA are distinct. Production deployment, Google
dashboard configuration, real-account refresh and iPhone/PWA behavior remain
owner-blocked until the checklist is actually executed.
