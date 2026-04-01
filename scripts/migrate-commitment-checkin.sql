-- ─────────────────────────────────────────────────────────────────────────────
-- migrate-commitment-checkin.sql
--
-- Run this in the Supabase SQL editor to add commitment_checkin support.
-- Safe to run multiple times (uses IF NOT EXISTS / DO NOTHING patterns).
-- ─────────────────────────────────────────────────────────────────────────────

-- Add commitment_checkin_done column to reflection_sessions if not already present.
-- Tracks whether the commitment check-in stage was completed in a given session.
ALTER TABLE reflection_sessions
  ADD COLUMN IF NOT EXISTS commitment_checkin_done boolean DEFAULT false;

-- Index for efficient lookup of a user's sessions ordered by date.
-- Used when fetching yesterday's commitment to populate commitment_checkin context.
CREATE INDEX IF NOT EXISTS reflection_sessions_user_date
  ON reflection_sessions(user_id, date DESC);
