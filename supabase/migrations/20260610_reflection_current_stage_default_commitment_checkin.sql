-- Fix current_stage default: should start at commitment_checkin, not wins
ALTER TABLE reflection_sessions
  ALTER COLUMN current_stage SET DEFAULT 'commitment_checkin';
