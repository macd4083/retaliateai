-- Migration: 20260414_goal_baseline_and_commitment_outcome.sql
-- Issue 3: Adds baseline_snapshot and baseline_date to goals so the AI coach
--          can reference where a user started.
-- Issue 4: Adds checkin_outcome to goal_commitment_log so the user's explicit
--          answer is stored instead of being derived from date math.
-- Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS).

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS baseline_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS baseline_date      DATE DEFAULT CURRENT_DATE;

ALTER TABLE goal_commitment_log
  ADD COLUMN IF NOT EXISTS checkin_outcome TEXT
    CHECK (checkin_outcome IN ('kept', 'missed', 'partial'));
