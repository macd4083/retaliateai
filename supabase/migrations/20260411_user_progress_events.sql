-- Migration: 20260411_user_progress_events.sql
-- Adds user_progress_events table for recording real threshold crossings.
-- Mirrors follow_up_queue pattern. Safe to run multiple times (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS user_progress_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   text        NOT NULL,
  -- 'motivation_signal_change' | 'followthrough_milestone' | 'blocker_fading'
  -- | 'foothold_unlocked' | 'first_depth_insight'
  payload      jsonb,
  -- always includes: { display_text: string, goal_id?, from?, to?, rate?, label? }
  session_id   uuid        REFERENCES reflection_sessions(id) ON DELETE SET NULL,
  surfaced_at  timestamptz,          -- null until AI references it in-session
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_progress_events_user
  ON user_progress_events(user_id, created_at DESC);

ALTER TABLE user_progress_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read their own progress events"
  ON user_progress_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Service role manages progress events"
  ON user_progress_events FOR ALL
  USING (true);

-- Add last_motivation_signal to goals so we can detect signal changes between sessions.
-- computeGoalMotivationSignal() is stateless/pure — without storing the previous result,
-- we cannot detect when the signal changes session-to-session.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS last_motivation_signal text;
