-- Creates session_causal_extracts table for storing win/miss cause raw text per session.
-- Raw text from wins and honest stages is stored verbatim for use in insight synthesis.
-- Rows older than 30 days are cleaned up by synthesize-insights.js.

CREATE TABLE IF NOT EXISTS session_causal_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES reflection_sessions(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('win_cause', 'miss_cause')),
  raw_text text NOT NULL,
  date date NOT NULL,
  last_seen_in_insight date,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_causal_extracts_user_date ON session_causal_extracts(user_id, date DESC);
CREATE INDEX IF NOT EXISTS session_causal_extracts_user_type ON session_causal_extracts(user_id, type, date DESC);

ALTER TABLE session_causal_extracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own causal extracts"
  ON session_causal_extracts FOR ALL
  USING (auth.uid() = user_id);
