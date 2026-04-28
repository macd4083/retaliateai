ALTER TABLE goal_commitment_log ADD COLUMN IF NOT EXISTS commitment_type text;
ALTER TABLE goal_commitment_log ADD COLUMN IF NOT EXISTS fragment_index integer;