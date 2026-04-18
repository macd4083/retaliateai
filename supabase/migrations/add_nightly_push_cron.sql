-- Supabase pg_cron job: nightly push notifications
--
-- This replaces the Vercel cron job for /api/push which required
-- running every minute (to match per-user preferred_reflection_time across timezones).
-- Vercel hobby plan only allows daily crons, so we use Supabase pg_cron instead.
--
-- Prerequisites:
--   1. Enable pg_cron and pg_net extensions in Supabase dashboard (Database > Extensions)
--   2. Replace 'https://your-vercel-deployment-url.vercel.app' with your actual Vercel production URL
--   3. Run this SQL in the Supabase SQL editor
--
-- To verify it is running:
--   SELECT * FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if it exists (makes this script idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-push-notifications') THEN
    PERFORM cron.unschedule('nightly-push-notifications');
  END IF;
END $$;

-- Schedule: runs every minute, calls the Vercel push endpoint
SELECT cron.schedule(
  'nightly-push-notifications',
  '* * * * *',
  $$
  SELECT pg_net.http_post(
    url := 'https://your-vercel-deployment-url.vercel.app/api/push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
