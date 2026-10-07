# Calendar scheduler release gate

Status: **not cleared for production** until the owner records a successful Vercel
deployment, dashboard configuration, and real-account/device checks below.
Automated tests are not evidence of Google consent or iPhone/PWA behavior.
No weekly review, Google event writeback, Apple sync, or legacy migration is included.

## Deployment evidence and unresolved blocker

- PR #361 commit `0996fecb3908fe69b65926eb0ed63eed520417d7` has a failed
  Vercel status for deployment
  [`dpl_EEdkhU6Seho1Zu1J5PrSrJU6EThg`](https://vercel.com/matt-macdonalds-projects/retaliateai/EEdkhU6Seho1Zu1J5PrSrJU6EThg).
  GitHub's status contains only the instruction to run
  `npx vercel inspect dpl_EEdkhU6Seho1Zu1J5PrSrJU6EThg --logs`; Vercel logs and
  dashboard access are unavailable here. This is the unresolved deploy blocker,
  not a diagnosed code/config root cause.
- **Required owner artifact:** provide that deployment URL and its first failing
  log section (failing command, error, and adjacent context; redact secrets).
  Until then, do not claim a Vercel fix or infer a root cause.
- [GitHub Actions validation on main](https://github.com/macd4083/retaliateai/actions/runs/37573843894)
  for `37a768b705123ea64f497b16d45e3fb11627330c` passed disposable-Postgres
  migration upgrade/idempotence tests, scheduler/Calendar tests, lint, the full
  regression suite, and production build. The separate successful "Vercel Preview
  Comments" check is not evidence of a successful deployment.
- Current local reproduction on Node 22.23.3 / npm 10.9.9:

  | Command | Exit | Wall time | Output |
  | --- | --- | --- | --- |
  | `npm ci` | 0 | 33.64s | 1179 packages added; lockfile unchanged; 58 dependency advisories reported |
  | `npm run lint` | 0 | 3.30s | No lint errors |
  | `npm run test` | 0 | 15.73s | 21 files, 452 tests passed |
  | `npm run build` | 0 | 8.08s | Vite built; PWA worker generated |

  These local results and the earlier CI workflow are not evidence of a successful
  remote deployment. The build emitted non-fatal stale Browserslist data and
  large-chunk warnings. Install reported 58 advisories (2 low, 18 moderate,
  36 high, 2 critical); this patch changes no dependencies. Do not run a breaking
  `npm audit fix --force` as a release workaround.
- The actual API imports `../server/googleCalendar.js` with matching Linux case;
  the deployment regression imports that API without Google configuration and
  verifies its JSON 401 response. Node crypto, `AbortSignal.timeout`, the
  `/api/` SPA rewrite exclusion, and browser-source boundaries (no server crypto
  or service-role secrets) are covered by tests. The production Vite build passes.
  These checks rule out those local build/import/bundle-boundary failures; they do
  not rule out Vercel project settings, limits, or environment configuration.

**Next owner action:** using authenticated Vercel access, run the exact inspect
command above and attach the required artifact. Then compare these settings:

| Setting | Required value/check |
| --- | --- |
| Root Directory | Repository root (contains `package.json`, `api/`, `server/`, `vercel.json`) |
| Framework | Vite |
| Install / Build / Output | `npm ci` / `npm run build` / `dist` |
| Node.js | 22.x; repository `engines` now matches CI |
| Functions | Confirm `api/google-calendar.js` and its server import are bundled |
| Function allowance | Repository now has 10 deployable JavaScript API functions, below Hobby's 12-function limit; verify packaging in deployment logs |
| Environment target | Production and Preview each need their own matching origins/redirects |

The obsolete `reflection-coach`, `goals`, and `synthesize-insights` endpoints and
their coaching UI/simulator are retired. No working Calendar, billing, feedback,
statistics or administration endpoint was removed. Successful Hobby deployment
remains **unverified**, and the earlier failed deployment's root cause remains
undiagnosed. Do not delete unrelated endpoints or upgrade a plan without the
actual error. Missing Google
configuration yields runtime unavailability, not a Vite build failure. Missing
`VITE_SUPABASE_*` causes a browser startup error at `src/lib/supabase/client.js:6-7`,
not an established explanation for the Vercel deployment status.
If a config-only cause is found, record its old → new value and log excerpt in
the release PR, redeploy, and rerun endpoint smoke tests. Do not label it fixed
before that evidence exists.

## Concrete release fixes

- Completed reviews load server evidence rather than stale dirty browser drafts.
  Checklist/manual-item responses and habit-save reloads are generation/owner
  guarded; late responses cannot overwrite a newer loaded review.
- Reopen is serialized with completion and clears Saving on both success and
  failure. Existing schedule/edit-dialog locks remain in place.
- The additive SQL patch freezes completed review fields and checklist outcomes,
  while allowing reopen and retaining completed timezone evidence across travel.
  Snapshot initialization must not add new habits to a completed review.
- OAuth callbacks validate the encrypted verifier's shape and browser binding
  before token exchange. Unreadable credentials or reduced refresh scopes require
  reconnect; a calendar-selection/disconnect race cannot report a nonexistent save.
- Auth loss during selection/connect/disconnect clears shared event overlays.
  When the last selected calendar disappears, Apply remains available to persist
  an empty selection.
- The desired-direction textarea uses its native `readOnly` state during completion;
  a deployment regression test prevents the unsupported `interactionDisabled` prop
  from returning.
- Node runtime parity, serial regression scripts, bounded CI steps, and explicit
  API/SPA/crypto/timeout regressions harden repeatable deployment validation.

## Google Cloud owner setup

1. In the intended Google Cloud project enable **Google Calendar API**. No Gmail,
   Drive, or write API is needed.
2. Configure the OAuth consent screen: External for personal/general Google
   accounts, or Internal only for the intended Workspace organization. Supply
   the real app support/contact details and authorized production domain.
3. In External **Testing** mode, add every QA Google account as a test user.
   Testing refresh tokens can expire after seven days for these Calendar scopes;
   test reconnect, and complete Google's required production verification before
   opening access beyond authorized testers. An Internal app cannot test with
   arbitrary personal accounts.
4. Create a **Web application** OAuth client. Request only:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
5. Add these exact authorized redirect URIs (including the query string):
   - Production: `https://retaliateai.com/api/google-calendar?action=callback`
   - Local full-stack server on port 3000:
     `http://localhost:3000/api/google-calendar?action=callback`
   - If using loopback IP instead:
     `http://127.0.0.1:3000/api/google-calendar?action=callback`
   - Preview: `https://<approved-stable-preview-host>/api/google-calendar?action=callback`,
     replacing the host with the actual approved deployment hostname.
6. Confirm the real production hostname; `retaliateai.com` is repository intent,
   not a dashboard observation. If it differs, change both redirect registration
   and environment values together. No wildcard redirects.

Use a stable preview alias with its own OAuth client/project and isolated
Supabase test data where possible. Never point a preview callback at production:
nonce cookies are host-bound and the backend requires redirect and origin equality.
Do not use `/auth/callback` for Calendar. Returns are only `/today` or `/settings`;
an external or modified destination must be rejected.

## Vercel environment checklist

Set values in the appropriate **Production / Preview / Development** environment,
without quotes or whitespace, then redeploy. Never print secret values in logs.

| Key | Format / purpose | Exposure |
| --- | --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | Web OAuth client ID, typically ending `.apps.googleusercontent.com` | Server-only |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Matching OAuth client secret | Server-only secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Exact registered URI above | Server-only |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Standard base64 encoding of exactly 32 random bytes (44 characters, ending `=`) | Server-only secret |
| `APP_ORIGIN` | `https://retaliateai.com` production; matching preview origin; `http://localhost:3000` local | Server-only |
| `SUPABASE_URL` | Intended project's `https://<project>.supabase.co` URL | Server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | Same project's privileged service role key | Server-only secret |
| `VITE_SUPABASE_URL` | Same project's public Supabase URL | Browser build-time |
| `VITE_SUPABASE_ANON_KEY` | Same project's public anon key, **never** service role | Browser build-time |
| `VITE_ENABLE_TODAY_V2_SCHEDULER` | Exact lowercase `true` to enable scheduler | Browser build-time |
| `PUBLIC_APP_ORIGIN` | Same public origin for existing email/billing links; not a substitute for `APP_ORIGIN` | Server-only |

Generate the encryption value privately with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`;
store it only in the secret manager/dashboard. Do not casually rotate it: old
encrypted credentials will become unreadable and users will need to reconnect.
Keep existing Stripe, Resend, push, and cron configuration unchanged.
The existing review-day boundary is 04:00 local; if overriding
`VITE_TODAY_V2_DAY_BOUNDARY_HOUR`, keep client and server values consistent.

For local OAuth, use a full-stack Vercel development server with port 3000 and
the Development environment. `npm run dev` alone is Vite and does **not** serve
`/api/google-calendar`. The local callback, browser origin, and `APP_ORIGIN`
must use the same host/port. Secure HttpOnly host cookies are used on HTTPS;
HTTP is permitted only for localhost/127.0.0.1.

## SQL rollout (owner database access required)

Apply SQL **before** deploying/enabling the scheduler:

This patch adds no SQL. For an existing database, apply only missing migrations
below; for a fresh installation, use the consolidated SQL as the alternative.

1. Check applied migration history. For an existing V2 installation apply any
   missing files in this order, using the **entire file** in Supabase SQL Editor:
   - [`20260928_today_v2_workflow.sql`](../supabase/migrations/20260928_today_v2_workflow.sql)
   - [`20261006_today_v2_controllable_and_first_five.sql`](../supabase/migrations/20261006_today_v2_controllable_and_first_five.sql)
   - [`20261007_today_v2_scheduling.sql`](../supabase/migrations/20261007_today_v2_scheduling.sql)
   - [`20261008_today_v2_schedule_review_lock.sql`](../supabase/migrations/20261008_today_v2_schedule_review_lock.sql)
   - [`20261009_today_v2_completion_release_guard.sql`](../supabase/migrations/20261009_today_v2_completion_release_guard.sql)
2. If scheduling already exists, apply the lock/repair migration last; do not
   reapply the base scheduling migration alone afterward (it replaces RPC bodies).
   The repair is atomic and idempotent. It backfills only V2 review provenance;
   it does not retime historical schedules or modify legacy records.
   **Always apply the new `20261009` release patch after the repair**, even if the
   older migrations were already marked applied. Copy/paste that entire linked
   SQL file; it adds completed-review/outcome guards without dropping data.
3. For a new installation the complete
   [`today_v2_isolated_workflow.sql`](../supabase/sql/today_v2_isolated_workflow.sql)
   is the consolidated alternative, not an extra migration to apply afterward.
4. Run the verification queries below. Do not run test fixture SQL against
   production; CI uses a disposable database with mock `auth` objects.
5. Deploy, then smoke-test API/routes and perform account/device QA.

If the application deployment needs rollback, restore the previous Vercel
deployment and disable the scheduler feature flag. This patch adds no schema
changes to reverse; do not drop or manually roll back the existing scheduler
migrations.
The separate `VITE_ENABLE_TODAY_V2` entry flag is retired and ignored.
`/reflection` and `/legacy/reflection` redirect to `/app`; there is no coaching
UI rollback in the current code. Historical reflection data and migrations are
preserved.

Copy/paste verification SQL (read-only):

```sql
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (
    ('today_v2_daily_reviews', 'completed_at'),
    ('today_v2_plan_inputs', 'first_five_minutes'),
    ('today_v2_schedule_blocks', 'source_review_id'));
-- Three rows; source_review_id must be NOT nullable.

select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'today_v2_schedule_blocks', 'today_v2_google_connections',
  'today_v2_google_oauth_states');
-- Three rows, all relrowsecurity = true.

select
  to_regprocedure('public.today_v2_replace_schedule(date,text,jsonb)') as schedule_rpc,
  to_regprocedure('public.today_v2_replace_plan_stable(date,date,text,text,text[],uuid[],text)') as stable_plan_rpc,
  to_regprocedure('public.today_v2_lock_source_review(uuid,date,text)') as review_lock,
  to_regprocedure('public.today_v2_finish_google_authorization(text,text,text[])') as oauth_finish;
-- All four non-null.

select tgname, tgenabled
from pg_trigger
where tgrelid in ('public.today_v2_schedule_blocks'::regclass,
                 'public.today_v2_daily_reviews'::regclass,
                 'public.today_v2_plan_inputs'::regclass,
                 'public.today_v2_commitment_fragments'::regclass,
                 'public.today_v2_habit_occurrences'::regclass)
  and tgname in ('today_v2_schedule_review_lock', 'today_v2_completed_review_lock',
                'today_v2_plan_review_lock', 'today_v2_fragment_review_lock',
                'today_v2_fragment_outcome_review_lock', 'today_v2_habit_outcome_review_lock');
-- Six present and enabled (O).

select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.today_v2_schedule_blocks'::regclass
  and conname in ('today_v2_schedule_review_owner_fk',
                 'today_v2_schedule_fragment_owner_fk',
                 'today_v2_schedule_habit_owner_fk');
-- Three validated composite owner foreign keys.

select count(*) as invalid_provenance
from public.today_v2_schedule_blocks b
left join public.today_v2_daily_reviews r
  on r.id = b.source_review_id and r.user_id = b.user_id
where r.id is null;
-- Zero.

select role_name, table_name,
       has_table_privilege(role_name, 'public.' || table_name, 'SELECT') as can_select
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('today_v2_google_connections'),
                   ('today_v2_google_oauth_states')) tables(table_name);
-- anon/authenticated false; service_role true. Never query encrypted token values.

select
  has_function_privilege('authenticated',
    'public.today_v2_replace_schedule(date,text,jsonb)', 'EXECUTE') as user_schedule,
  has_function_privilege('authenticated',
    'public.today_v2_finish_google_authorization(text,text,text[])', 'EXECUTE') as user_oauth,
  has_function_privilege('service_role',
    'public.today_v2_finish_google_authorization(text,text,text[])', 'EXECUTE') as server_oauth;
-- true, false, true.
```

## Deterministic validation

Run Node 22.x, `npm ci`, `npm run test:scheduler`, `npm run lint`,
`npm run test:ci`, then `npm run build`. Vitest does not support Jest's
`--runInBand`; the scripts use one worker and disable file parallelism instead.
Every test file remains isolated, with existing assertions retained. The focused
command includes the scheduler feature flag test as well as API, services,
state hook, and UI suites. Google calls/storage/retry sleeps are injected mocks;
UI fetches are mocked. Hook/UI cleanup restores fake timers and unmounts roots.

Latest baseline suites exited normally, so neither a network/open-handle hang
nor a fake-timer timeout was reproduced. Do not claim a recovered historical
timeout root cause. Serial workers reduce resource contention; job/step limits
make a recurrence fail visibly rather than hang indefinitely. CI still runs
full coverage, SQL upgrade assertions, and repeated repair application.

Final post-patch CI-equivalent results (Node 22.23.3, wall times; not a remote
Vercel deployment):

| Command / sequence | Exit | Wall time | Output |
| --- | --- | --- | --- |
| `npm ci` | 0 | 18.58s | Clean install; same existing 58 audit advisories |
| `npm run test:scheduler` | 0 | 12.36s | 9 files, 237 tests passed |
| `npm run test:ci` | 0 | 25.28s | 21 files, 451 tests passed |
| `npm run lint` | 0 | 4.55s | No lint errors |
| `npm run build` | 0 | 7.99s | Vite/PWA build successful; non-fatal chunk warning |
| Disposable PostgreSQL 16: consolidated SQL, repair ×2, release guard ×2, three SQL regression scripts | 0 | 2.55s | Three fixture rollbacks, no leftover users |

The additive patch also passed standalone repeat-application and SQL regressions
(1.99s), and an injected final-statement failure rolled back every new guard
function. Consolidated SQL repeated twice plus SQL regressions passed (2.17s).
Six completion/mutation concurrency checks waited and rejected completed writes;
concurrent snapshot ensure/response committed without deadlock. Existing
`20261008` migration bytes are unchanged. The SQL contract test enforces the
consolidated file's exact migration concatenation, including the new patch.

### Review/security evidence limitation

An independent read-only code review found no significant issues, including the
final additive SQL guards and snapshot lock ordering. The automated review
service could not run because `model claude-sonnet-4.6 not found in registry`.
The required combined validation tool completed CodeQL's Actions analysis with
zero alerts, but reported `Analysis timed out before every language completed`.
**This is not a completed all-language security scan.** Do not disable checks or
treat the partial result as a pass. Before release, the maintainer must obtain
the complete JavaScript/all-language CodeQL report in an available validation
environment and attach it to the PR. The platform tool warned that retrying the
same sandbox scan would not complete; it was not repeatedly retried.

## Endpoint and real-account/device QA (owner must record results)

Use an authorized Google test account and disposable V2 data. For each unchecked
row record date, deployment URL/SHA, account label (not credentials), device/OS,
pass/fail, and a redacted screenshot or error code. **All rows below remain
unperformed on real accounts/devices by the agent.**

| Done | Action | Expected outcome |
| --- | --- | --- |
| [ ] | Open `/today`, `/home`, `/settings` directly and reload; open `/legacy/reflection` | SPA loads correct authenticated route, not 404; legacy bookmark redirects through `/app` to V2 even with the retired entry flag set to false |
| [ ] | GET `/api/google-calendar?action=status` signed out | HTTP 401 JSON `unauthorized`, `Cache-Control: no-store`; never index.html or a browser asset |
| [ ] | In signed-in app inspect status with valid session | Configured/schemaAvailable true after setup; no secret/token fields. Missing config/schema gives diagnostic, not broken review flow |
| [ ] | Connect from Settings and from Review & Plan | Google consent requests only two readonly scopes; successful callback returns to initiating allowlisted route |
| [ ] | Cancel consent; retry, then replay an already-used callback | Cancel leaves review usable; retry works; replay rejected without replacing credentials |
| [ ] | Select primary plus a secondary calendar, then select none and save | Matching timed/all-day overlay; empty selection clears overlay without disconnecting |
| [ ] | Remove access to a selected secondary calendar in Google and reload | Stale calendar selection is recoverable; no phantom busy blocks or unusable scheduler |
| [ ] | Refresh expired token normally; revoke grant in Google and reload | Normal expiry refreshes server-side; revoked grant shows reconnect-required; reconnect restores overlay |
| [ ] | Disconnect, including while an event fetch is pending | Connection/overlay cleared; late response does not repopulate them; Google tokens never visible in browser |
| [ ] | Schedule a real commitment/habit, edit time/duration, unschedule, reload | Correct owned source persists once; removing it leaves it available unscheduled |
| [ ] | Schedule 23:30–00:30 next day; inspect Review & Plan and Home | Explicit cross-midnight/end-day display; no duplicate/missing block; correct local timezone |
| [ ] | Complete source review while edit dialog is open or save is pending | No post-completion edits; dialog cannot save; completion settles without stuck Saving. Reload agrees with server |
| [ ] | Open same review in two tabs: complete in one, save schedule in the other | Server rejects completed-source mutation even if other tab is stale; no overwrite |
| [ ] | Reopen completed review and reschedule | Editing becomes available only after successful reopen; existing schedules remain intact |
| [ ] | iPhone Safari: OAuth round trip, calendar selection, dialog, touch scheduling, midnight display | Cookie/auth survives return; controls usable without hover, keyboard/viewport do not hide Save |
| [ ] | iPhone Add to Home Screen: sign-in/out launch and OAuth round trip | PWA opens correct V2 route; returning from Safari is recoverable; no infinite auth loop or stale overlay |
| [ ] | iPhone PWA: background/resume and deploy update with unsaved edits | No forced reload/data loss; close/reopen activates update; `/api/` never answered by offline SPA fallback |

Owner release sign-off requires: exact Vercel failure diagnosis/config diff,
successful deployment evidence, SQL verification output, Google dashboard
confirmation, complete security scan, and results for every applicable QA row. A failed row blocks
release; attach its exact reproduction and next action rather than “should work”.
