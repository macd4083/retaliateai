ALTER TABLE goal_commitment_log
  ADD COLUMN IF NOT EXISTS fragment_index integer DEFAULT 0;
