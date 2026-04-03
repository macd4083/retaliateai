-- Migration: 20260403_user_insights.sql
-- Adds user_insights table for persisting generated pattern narratives.
-- Safe to run multiple times (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS user_insights (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  narratives       jsonb       NOT NULL DEFAULT '[]',
  session_count    integer     NOT NULL DEFAULT 0,
  synthesized_at   timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_insights_user_id      ON user_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_user_insights_synthesized  ON user_insights(synthesized_at);

ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read their own insights"
  ON user_insights FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Service role manages insights"
  ON user_insights FOR ALL
  USING (true);
