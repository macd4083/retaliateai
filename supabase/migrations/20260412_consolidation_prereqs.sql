-- Migration: 20260412_consolidation_prereqs.sql
-- Adds first_seen_date, last_seen_date, strength_evidence to user_insights.
-- Backfills first/last seen from synthesized_at for existing rows.
-- Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS).

ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS first_seen_date   date;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS last_seen_date    date;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS strength_evidence text;

-- Backfill: use synthesized_at for rows that don't have dates yet
UPDATE user_insights
SET
  first_seen_date = synthesized_at::date,
  last_seen_date  = synthesized_at::date
WHERE first_seen_date IS NULL;
