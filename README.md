# Retaliate AI

The public product is the structured Today V2 workflow: review commitments and
habits, choose tomorrow's direction and controllable effort, define measured
actions and the first five minutes, and track follow-through.

## Route and link audit

| Entry point | Destination / behavior |
| --- | --- |
| Generic Open app, signed-in landing, default login/signup/confirmation/onboarding | `/app` |
| `/app` | Authentication and onboarding first; V2 completion resolver sends incomplete/unavailable completion metadata to `/today`, completed reviews to `/home` |
| Old `/reflection` bookmarks | Compatibility redirect to `/app` |
| Historical AI dialogue | `/legacy/reflection`, authenticated; code and legacy tables retained |
| Today navigation and live checklist | `/home` |
| Review & Plan navigation and explicit nightly links | `/today`; completed reviews retain reopen/edit behavior |
| Progress navigation | `/insights`; existing reporting retained, V2 data migration is separate work |
| Settings, upgrade and Stripe success/cancel | `/settings` (success retains `?checkout=success`) |
| Old `/start/guest` campaign links | Signup with attribution preserved; no new anonymous dialogue |
| Historical `/post-session/next-steps` conversion | Existing signup/commitment-transfer behavior retained, structured-product copy |
| Password recovery | `/auth/reset-password`; no app redirect before a successful password update |
| Push reminders, notification fallback and old `/reflection` payloads | `/today`; focus and navigate an existing same-origin app window |
| Trial reminders and paid welcome email Open app | `/app`; upgrade stays `/settings` |
| Missed V2 review email | `/today`, only after prior completed V2 use and two missed review days |
| PWA manifests (static and Vite-generated) | `start_url: /app`, stable historical `id: /reflection`, existing `/` scope and icons |
| Sitemap | Public `/`, `/privacy`, `/terms`; no private app routes |
| Administration access fallback | `/app`; editor page selectors use the structured navigation labels |

Allowlisted same-origin intended destinations (including `/today` and
`/settings`) survive authentication. Other origins, protocol-relative paths and
unrecognized paths fall back to `/app`. The authentication callback remains
authentication-only, not Calendar OAuth.

### Deliberately retained legacy references

`/legacy/reflection`, its AI coach, guest records and signup transfer remain.
Legacy reflection tables, historical Insights queries, admin session tooling,
and isolated admin dialogue demos are not migrated or deleted. `/reflection`
survives as a compatibility input (route/auth/old notification handling) and
the explicit PWA manifest identity, not a normal navigation or launch
destination. The manifest ID preserves the previous implicit app identity
while the start URL changes. This does not rebuild Progress.

`VITE_ENABLE_TODAY_V2=false` is a documented emergency rollback: rebuild and
redeploy to send generic `/app` entry to `/legacy/reflection`. Explicit `/today`
and `/home` and structured navigation stay available. Restore `true` and
redeploy to return generic entry to the V2 resolver. See
[architecture boundaries](docs/V2_ARCHITECTURE.md).

## Manual verification

Use test accounts and a preview deployment; do not trigger real email delivery
for automated tests.

1. Signed out, open `/app` and `/reflection`: login, finish onboarding if needed,
   then arrive at `/today`. Complete a review and reopen `/app`: arrive at
   `/home`. Open `/today` explicitly and verify reopen/edit still works.
   With optional completion metadata unavailable, `/app` must fall back to
   `/today`. Open `/legacy/reflection` explicitly and verify historical data.
2. Verify drawer labels and titles: Today, Review & Plan, Progress, Settings.
   Admin links should be separate. Check landing signup CTAs and old campaign
   links: signup is required, never a new AI dialogue.
3. Sign in normally, sign up with email confirmation, and use OTP where enabled.
   Repeat with `?next=/today` and `?next=/settings`; repeat with an external
   URL, `//evil.example` and an unknown path: these must resolve to `/app`.
   Check confirmation in a second tab and expired/invalid confirmation recovery.
   Check configured OAuth authentication without changing callback semantics.
4. Request password recovery, follow the email, and stay on the password form
   until a successful update. An invalid link must offer a new reset request.
   Sign out and confirm private routes require authentication again.
5. Install from Chrome/Android and Safari's Share → Add to Home Screen on iOS.
   Inspect both served manifests: `start_url` is `/app`, `id` is `/reflection`,
   scope and icons unchanged.
   Launch signed out and signed in before/after completing a review. Existing
   installations with old start URLs must resolve through compatibility routing.
6. Keep an unsaved review open while deploying an update: no automatic reload.
   Close all app tabs/windows, reopen, then confirm the updated worker becomes
   active. Check the generated worker imports the push event handlers.
7. Send a test push to a test account only: missing URL, `/today` and legacy
   `/reflection` all open Review & Plan. With an app window open at Settings,
   clicking the notification should focus it and navigate to `/today`. External
   notification URLs must not open an untrusted origin.
8. With mocked delivery, verify trial and welcome links, V2-only lapse detection,
   seven-day cooldown, timezone/boundary transitions and database error cases.
   Missing/wrong cron authorization must return 401 without querying or sending.
   Test Stripe checkout success/cancel in Stripe test mode only.

## Deployment configuration

For the scheduler/Google Calendar release, use the
[owner setup, SQL rollout, deployment evidence, and device QA runbook](docs/CALENDAR_SCHEDULER_RELEASE.md).

Production domain intent is `https://retaliateai.com`, evidenced by the canonical
metadata, sitemap and existing Stripe redirects, not verified live dashboard
state. No production settings or database changes have been applied by this PR.

- **Vercel environment:** set `PUBLIC_APP_ORIGIN=https://retaliateai.com` for
  production; use the preview origin for isolated test deployments. Server-side
  email and billing links share this setting and never use the request Host.
- **Vercel environment:** configure a strong `CRON_SECRET`. Vercel cron sends
  `Authorization: ******; both automated email endpoints and the
  scheduled push endpoint reject absent/invalid credentials. Keep the existing
  daily email schedules in `vercel.json`. Do not put the secret in client/VITE
  variables or commit it.
- **V2 boundary:** the default review day ends at 04:00 local time. If overriding
  it, set `VITE_TODAY_V2_DAY_BOUNDARY_HOUR` consistently for the client build and
  server deployment (integer 0–23), then rebuild/redeploy.
- **Supabase Auth dashboard:** Site URL should be the canonical public origin.
  Set production redirect allowlist entries to:
  - `https://retaliateai.com/auth/callback`
  - `https://retaliateai.com/auth/callback?next=**`
  - `https://retaliateai.com/auth/reset-password`
  - `https://retaliateai.com/auth/reset-password?next=**`
  Add equivalent entries only for explicitly authorized preview/local origins;
  do not wildcard arbitrary production origins. The client still independently
  allowlists the return path. Ensure confirmation templates use Supabase's
  confirmation URL / supplied redirect URL rather than a legacy hardcoded path.
- Keep existing Supabase, Resend, VAPID and Stripe credentials/price settings.
  Verify the Resend sender is authorized; do not change trial-extension rules.
- Update the existing Supabase push cron authorization using the complete SQL in
  [the cron migration](supabase/migrations/add_nightly_push_cron.sql); see its
  prerequisite, verification and ordering instructions before deployment.
- Serve both manifests and the generated `/sw.js` plus its imported push worker.
  Preserve the worker registration URL and root scope for installed apps.
  `robots.txt` is discovery guidance, never authentication or data access control.

### Database-before-code order

1. Confirm the existing Today V2 migrations have been applied, including
   `completed_at`; no legacy table migration is required here. Configure Vercel's
   server secrets and, in Supabase Vault, `public_app_origin` and `cron_secret`
   with matching values.
2. Copy/paste the entire cron migration linked above into the Supabase SQL editor.
   It updates only the named scheduled job and enables extensions if absent;
   no application data is dropped or moved. Authorization headers are harmless
   to the previous endpoint, so provision this before deploying the protected one.
3. Deploy the code, then execute the migration's verification queries. Confirm
   one active minute job and HTTP 200 responses, not just successful cron SQL
   execution. Confirm Vercel's email crons use the configured authorization.

Optional schema verification (no data modification):

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'today_v2_daily_reviews'
  and column_name in ('local_date', 'timezone_name', 'completed_at');
```

If required V2 schema is absent, apply the repository's existing V2 migrations
before this deployment. Failed completion queries deliberately suppress lapse
emails rather than classifying users as inactive.

### Review timezone and cross-device limitation

V2 review dates use the browser timezone. Lapse detection uses the latest
completed V2 review's stored timezone, not a profile's possibly stale default.
Invalid/missing timezones and failed queries suppress delivery. The per-device
`today_v2_day_boundary_hour` localStorage override is not synchronized to profiles
or other devices: server reminders use the deployment-wide boundary. Travel or
device-only overrides can therefore differ until a completed review records the
current timezone. Cross-device preference synchronization is separate work.
