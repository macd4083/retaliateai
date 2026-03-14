-- Enable pgvector extension (safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- reflection_sessions: columns for the full coaching pipeline
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS checklist jsonb;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS exercises_run text[];
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS consecutive_excuses integer DEFAULT 0;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS mood_end_of_day text;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS tomorrow_commitment text;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS self_hype_message text;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS wins jsonb;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS is_complete boolean DEFAULT false;

-- user_profiles: living document columns (AI-updated post-session)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS values text[];
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS short_term_state text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS long_term_patterns text[];
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS growth_areas text[];
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS strengths text[];
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS exercises_explained text[];

-- follow_up_queue table
CREATE TABLE IF NOT EXISTS follow_up_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES reflection_sessions(id) ON DELETE SET NULL,
  context text,
  question text NOT NULL,
  check_back_after date NOT NULL,
  trigger_condition text,
  triggered boolean DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- growth_markers table
CREATE TABLE IF NOT EXISTS growth_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL,
  occurrence_count integer DEFAULT 1,
  exercises_run text[],
  check_in_after date,
  check_in_message text,
  checked_in boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_reflection_sessions(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int DEFAULT 3
)
RETURNS TABLE (id uuid, date date, summary text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, date, summary,
    1 - (embedding <=> query_embedding) AS similarity
  FROM reflection_sessions
  WHERE user_id = match_user_id
    AND embedding IS NOT NULL
    AND summary IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RLS policies
ALTER TABLE follow_up_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_markers ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can manage their own follow_up_queue"
  ON follow_up_queue FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can manage their own growth_markers"
  ON growth_markers FOR ALL
  USING (auth.uid() = user_id);
