-- Migration: 20260405_goal_commitment_log.sql
-- Adds goal_commitment_log table for tracking per-commitment kept/missed outcomes.
-- Feeds motivation_signal for goals. Safe to run multiple times (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS goal_commitment_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id       uuid        REFERENCES reflection_sessions(id) ON DELETE SET NULL,
  goal_id          uuid        REFERENCES goals(id) ON DELETE CASCADE,
  commitment_text  text        NOT NULL,
  date             date        NOT NULL,
  kept             boolean,
  evaluated_at     timestamptz,
  motivation_signal text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goal_commitment_log_user_id  ON goal_commitment_log(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_commitment_log_goal_id  ON goal_commitment_log(goal_id);

ALTER TABLE goal_commitment_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read their own commitment log"
  ON goal_commitment_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Service role manages commitment log"
  ON goal_commitment_log FOR ALL
  USING (true);
