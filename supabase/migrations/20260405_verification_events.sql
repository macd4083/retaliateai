-- Migration: 20260405_verification_events.sql
-- Adds verification_events table used by the cross-device email verification flow.
-- Safe to run multiple times (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS verification_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read their own verification events"
  ON verification_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Service role manages verification events"
  ON verification_events FOR ALL
  USING (true);
