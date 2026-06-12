-- session_thinking_events
-- Records every meaningful AI decision event during a reflection session.
CREATE TABLE IF NOT EXISTS session_thinking_events (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                       UUID REFERENCES reflection_sessions(id) ON DELETE CASCADE,
  user_id                          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sim_run_id                       TEXT,
  turn_index                       INTEGER,
  event_type                       TEXT NOT NULL,
  classifier_intent                TEXT,
  classifier_energy_level          TEXT,
  classifier_accountability_signal TEXT,
  classifier_emotional_state       TEXT,
  classifier_suggested_exercise    TEXT,
  classifier_energy_type           TEXT,
  classifier_depth_opportunity     BOOLEAN,
  classifier_full_output           JSONB,
  stage_from                       TEXT,
  stage_to                         TEXT,
  stage_trigger_condition          TEXT,
  exercise_id                      TEXT,
  exercise_label                   TEXT,
  exercise_trigger_path            TEXT,
  directive_type                   TEXT,
  directive_priority               INTEGER,
  directive_stage                  TEXT,
  directive_reason                 TEXT,
  ai_why_this_question             TEXT,
  ai_emotional_read                TEXT,
  ai_strategic_intent              TEXT,
  ai_raw_reasoning                 JSONB,
  created_at                       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thinking_events_session_id ON session_thinking_events(session_id);
CREATE INDEX IF NOT EXISTS idx_thinking_events_user_id ON session_thinking_events(user_id);
CREATE INDEX IF NOT EXISTS idx_thinking_events_sim_run_id ON session_thinking_events(sim_run_id);
CREATE INDEX IF NOT EXISTS idx_thinking_events_event_type ON session_thinking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_thinking_events_created_at ON session_thinking_events(created_at);

ALTER TABLE reflection_messages
  ADD COLUMN IF NOT EXISTS ai_reasoning JSONB;

ALTER TABLE session_thinking_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_thinking_events'
      AND policyname = 'Users can manage their own session thinking events'
  ) THEN
    CREATE POLICY "Users can manage their own session thinking events"
      ON session_thinking_events
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_thinking_events'
      AND policyname = 'Admins can read all session thinking events'
  ) THEN
    CREATE POLICY "Admins can read all session thinking events"
      ON session_thinking_events
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM user_profiles
          WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reflection_sessions'
      AND policyname = 'Admins can read all reflection sessions'
  ) THEN
    CREATE POLICY "Admins can read all reflection sessions"
      ON reflection_sessions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM user_profiles
          WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reflection_messages'
      AND policyname = 'Admins can read all reflection messages'
  ) THEN
    CREATE POLICY "Admins can read all reflection messages"
      ON reflection_messages
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM user_profiles
          WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
      );
  END IF;
END $$;
