-- Minute-by-minute daily-review reminders; no application tables or data are changed.
-- Prerequisites: enable pg_cron, pg_net and Supabase Vault in the dashboard.
-- Before applying, store these Vault secrets via the dashboard (never commit values):
--   public_app_origin: https://retaliateai.com (match Vercel PUBLIC_APP_ORIGIN)
--   cron_secret: the same value as Vercel's server-only CRON_SECRET
-- Existing Vercel email crons send Authorization: ****** automatically.
-- Deployment order: provision the Vercel environment variables and Vault secrets
-- first, apply this database cron update against the existing endpoint, verify the
-- named job, then deploy the authenticated /api/push implementation and verify HTTP 200.
-- The existing endpoint ignores the added authorization header; the new endpoint
-- requires it. Missing Vault secrets send no request.
-- cron.schedule updates the named job in place, preserving unrelated jobs.
-- Verify after deploy:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--     WHERE jobname = 'nightly-push-notifications';
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'nightly-push-notifications')
--     ORDER BY start_time DESC LIMIT 10;
--   SELECT status_code, timed_out, error_msg FROM net._http_response
--     ORDER BY created DESC LIMIT 10;
-- Expected: one active minute job and HTTP 200. Never SELECT decrypted_secret in logs.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'nightly-push-notifications',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := rtrim(origin.decrypted_secret, '/') || '/api/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret.decrypted_secret
    ),
    body := '{}'::jsonb
  )
  FROM vault.decrypted_secrets AS origin
  CROSS JOIN vault.decrypted_secrets AS secret
  WHERE origin.name = 'public_app_origin'
    AND secret.name = 'cron_secret'
    AND nullif(trim(secret.decrypted_secret), '') IS NOT NULL
    AND origin.decrypted_secret ~ '^https://[^/]+/?$';
  $$
);
