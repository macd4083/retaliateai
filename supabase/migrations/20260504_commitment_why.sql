-- Adds commitment_why to goal_commitment_log so fragment-level whys persist
-- independent of whether the commitment was linked to a tracked goal.
ALTER TABLE goal_commitment_log ADD COLUMN IF NOT EXISTS commitment_why text;
