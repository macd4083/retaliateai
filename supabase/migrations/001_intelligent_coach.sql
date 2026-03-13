-- Migration: 001_intelligent_coach.sql
-- Adds tables and columns required by the intelligent reflection coaching system.
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─── reflection_sessions additions ───────────────────────────────────────────

ALTER TABLE reflection_sessions
  ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '{"wins":false,"honest":false,"plan":false,"identity":false}',
  ADD COLUMN IF NOT EXISTS engagement_level TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS exercises_run JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS intent_signals JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS consecutive_excuses INTEGER DEFAULT 0;

-- ─── user_profiles additions ─────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS exercises_explained JSONB DEFAULT '[]';

-- ─── follow_up_queue ──────────────────────────────────────────────────────────
-- Stores coach-generated follow-up questions to surface on future sessions.

CREATE TABLE IF NOT EXISTS follow_up_queue (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        UUID        REFERENCES reflection_sessions(id),
  created_at        DATE        NOT NULL DEFAULT CURRENT_DATE,
  check_back_after  DATE        NOT NULL,
  context           TEXT        NOT NULL,
  question          TEXT        NOT NULL,
  triggered         BOOLEAN     DEFAULT FALSE,
  trigger_condition TEXT,
  resolved_at       DATE
);

CREATE INDEX IF NOT EXISTS idx_follow_up_queue_user_id    ON follow_up_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_queue_check_back ON follow_up_queue(check_back_after);

-- ─── growth_markers ───────────────────────────────────────────────────────────
-- Tracks recurring themes and schedules follow-up check-ins after 3+ occurrences.

CREATE TABLE IF NOT EXISTS growth_markers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme            TEXT        NOT NULL,
  exercises_run    JSONB       DEFAULT '[]',
  occurrence_count INTEGER     DEFAULT 1,
  first_surfaced   DATE        NOT NULL DEFAULT CURRENT_DATE,
  check_in_after   DATE,
  check_in_message TEXT,
  checked_in       BOOLEAN     DEFAULT FALSE,
  user_response    TEXT,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_markers_user_id ON growth_markers(user_id);
CREATE INDEX IF NOT EXISTS idx_growth_markers_theme   ON growth_markers(theme);
