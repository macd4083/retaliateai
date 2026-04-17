ALTER TABLE reflection_sessions
  ADD COLUMN IF NOT EXISTS commitment_minimum text,
  ADD COLUMN IF NOT EXISTS commitment_stretch  text,
  ADD COLUMN IF NOT EXISTS commitment_score    integer;
