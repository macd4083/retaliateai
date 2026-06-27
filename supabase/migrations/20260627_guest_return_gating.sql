-- Migration: 20260627_guest_return_gating.sql
--
-- Ensures the four guest-campaign columns are present in user_profiles,
-- backfills any NULL values so application logic can rely on concrete defaults,
-- and adds an index used by the return-visit gate query.
--
-- Safe to run multiple times — all operations are idempotent.
--
-- Manual SQL for Supabase dashboard (copy/paste into SQL editor):
--
--   ALTER TABLE public.user_profiles
--     ADD COLUMN IF NOT EXISTS is_guest_campaign_user        boolean DEFAULT false,
--     ADD COLUMN IF NOT EXISTS completed_first_session       boolean DEFAULT false,
--     ADD COLUMN IF NOT EXISTS requires_signup_for_next_session boolean DEFAULT false,
--     ADD COLUMN IF NOT EXISTS campaign_attribution          jsonb   DEFAULT '{}'::jsonb;
--
--   UPDATE public.user_profiles
--   SET
--     is_guest_campaign_user            = COALESCE(is_guest_campaign_user, false),
--     completed_first_session           = COALESCE(completed_first_session, false),
--     requires_signup_for_next_session  = COALESCE(requires_signup_for_next_session, false),
--     campaign_attribution              = COALESCE(campaign_attribution, '{}'::jsonb)
--   WHERE
--     is_guest_campaign_user           IS NULL
--     OR completed_first_session       IS NULL
--     OR requires_signup_for_next_session IS NULL
--     OR campaign_attribution          IS NULL;
--
--   CREATE INDEX IF NOT EXISTS idx_user_profiles_guest_campaign
--     ON public.user_profiles (is_guest_campaign_user, completed_first_session, requires_signup_for_next_session);
--
-- Rollback (disables gating quickly without data loss):
--   UPDATE public.user_profiles
--     SET requires_signup_for_next_session = false
--   WHERE requires_signup_for_next_session = true;
--   -- To fully remove the columns (destructive, only if sure):
--   -- ALTER TABLE public.user_profiles
--   --   DROP COLUMN IF EXISTS is_guest_campaign_user,
--   --   DROP COLUMN IF EXISTS completed_first_session,
--   --   DROP COLUMN IF EXISTS requires_signup_for_next_session,
--   --   DROP COLUMN IF EXISTS campaign_attribution;

-- ── 1. Ensure columns exist ───────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_guest_campaign_user             boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_first_session            boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_signup_for_next_session   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS campaign_attribution               jsonb   DEFAULT '{}'::jsonb;

-- ── 2. Backfill NULLs so app logic never sees an unexpected NULL ──────────────
UPDATE public.user_profiles
SET
  is_guest_campaign_user            = COALESCE(is_guest_campaign_user, false),
  completed_first_session           = COALESCE(completed_first_session, false),
  requires_signup_for_next_session  = COALESCE(requires_signup_for_next_session, false),
  campaign_attribution              = COALESCE(campaign_attribution, '{}'::jsonb)
WHERE
  is_guest_campaign_user           IS NULL
  OR completed_first_session       IS NULL
  OR requires_signup_for_next_session IS NULL
  OR campaign_attribution          IS NULL;

-- ── 3. Compound index for the return-visit gate query ────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_guest_campaign
  ON public.user_profiles (is_guest_campaign_user, completed_first_session, requires_signup_for_next_session);
