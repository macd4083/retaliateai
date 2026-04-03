-- Migration: 20260403_user_insights_v2.sql
-- Extends user_insights with per-insight rich fields.
-- Safe to run on existing table (uses ADD COLUMN IF NOT EXISTS).
-- Depends on: 20260403_user_insights.sql (which defines user_id, synthesized_at, and base columns).

ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS pattern_narrative   TEXT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS trigger_context     TEXT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS user_quote          TEXT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS foothold            TEXT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS pattern_label       TEXT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS pattern_type        TEXT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS sessions_synthesized_from INT DEFAULT 0;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS last_updated_at     TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS unlocked_practices  TEXT[];
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS is_active           BOOLEAN DEFAULT TRUE;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS confidence_score    FLOAT;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS replaced_by         UUID REFERENCES user_insights(id);

-- synthesized_at already exists from 20260403_user_insights.sql
CREATE INDEX IF NOT EXISTS idx_user_insights_user_active ON user_insights(user_id, is_active, synthesized_at DESC);
