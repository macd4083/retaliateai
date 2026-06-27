-- Migration: 20260627_guest_timing_policy.sql
--
-- Adds guest session timing columns to user_profiles to support the
-- 2-day access / 7-day cooldown policy for guest campaign users.
--
-- Safe to run multiple times — all operations are idempotent.
--
-- ── Manual SQL for Supabase dashboard (copy/paste into SQL editor) ───────────
--
--   ALTER TABLE public.user_profiles
--     ADD COLUMN IF NOT EXISTS guest_started_at    timestamptz,
--     ADD COLUMN IF NOT EXISTS guest_cooldown_until timestamptz,
--     ADD COLUMN IF NOT EXISTS guest_usage_count   integer DEFAULT 0;
--
--   UPDATE public.user_profiles
--   SET guest_usage_count = 0
--   WHERE guest_usage_count IS NULL;
--
--   CREATE INDEX IF NOT EXISTS idx_user_profiles_guest_timing
--     ON public.user_profiles (guest_started_at, guest_cooldown_until);
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--
--   -- To disable timing policy quickly (rows preserved):
--   UPDATE public.user_profiles
--     SET guest_started_at = NULL, guest_cooldown_until = NULL
--   WHERE guest_started_at IS NOT NULL;
--
--   -- To fully remove the columns (destructive, only if sure):
--   -- ALTER TABLE public.user_profiles
--   --   DROP COLUMN IF EXISTS guest_started_at,
--   --   DROP COLUMN IF EXISTS guest_cooldown_until,
--   --   DROP COLUMN IF EXISTS guest_usage_count;
--
-- ── 1. Ensure columns exist ───────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS guest_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS guest_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS guest_usage_count   integer DEFAULT 0;

-- ── 2. Backfill NULL count values (timestamptz columns intentionally stay NULL
--       until first guest use — they serve as a "never started" sentinel) ──────
UPDATE public.user_profiles
SET guest_usage_count = 0
WHERE guest_usage_count IS NULL;

-- ── 3. Optional index for timing-window queries ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_guest_timing
  ON public.user_profiles (guest_started_at, guest_cooldown_until);
