-- Daily workflow redesign schema: plan actions, action reviews, habits, and check-in compatibility.

ALTER TABLE reflection_sessions
  ADD COLUMN IF NOT EXISTS checkin_outcome TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reflection_sessions_checkin_outcome_check'
  ) THEN
    ALTER TABLE reflection_sessions
      ADD CONSTRAINT reflection_sessions_checkin_outcome_check
      CHECK (checkin_outcome IN ('kept', 'partial', 'missed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS daily_plan_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES reflection_sessions(id) ON DELETE SET NULL,
  plan_date date NOT NULL,
  action_text text NOT NULL,
  completion_measure text,
  minimum_version text,
  stretch_version text,
  is_primary boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_actions_user_plan_date
  ON daily_plan_actions(user_id, plan_date, display_order);

ALTER TABLE daily_plan_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'daily_plan_actions'
      AND policyname = 'Users can manage their own daily plan actions'
  ) THEN
    CREATE POLICY "Users can manage their own daily plan actions"
      ON daily_plan_actions
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS daily_action_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES reflection_sessions(id) ON DELETE SET NULL,
  review_date date NOT NULL,
  plan_action_id uuid REFERENCES daily_plan_actions(id) ON DELETE SET NULL,
  action_text text NOT NULL,
  completion_measure text,
  outcome text NOT NULL CHECK (outcome IN ('done', 'partial', 'missed')),
  is_primary boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_action_reviews_user_review_date
  ON daily_action_reviews(user_id, review_date, display_order);

ALTER TABLE daily_action_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'daily_action_reviews'
      AND policyname = 'Users can manage their own daily action reviews'
  ) THEN
    CREATE POLICY "Users can manage their own daily action reviews"
      ON daily_action_reviews
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  input_type text NOT NULL CHECK (input_type IN ('boolean', 'number', 'duration')),
  unit text,
  scheduled_days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,0],
  display_order integer NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_habits_user_active
  ON user_habits(user_id, is_archived, display_order);

DROP INDEX IF EXISTS idx_user_habits_user_name_archived_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_habits_user_active_name_unique
  ON user_habits(user_id, name)
  WHERE is_archived = false;

ALTER TABLE user_habits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_habits'
      AND policyname = 'Users can manage their own habits'
  ) THEN
    CREATE POLICY "Users can manage their own habits"
      ON user_habits
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION seed_default_habits_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('seed_default_habits_for_user'), hashtext(p_user_id::text));

  INSERT INTO user_habits (user_id, name, input_type, unit, scheduled_days, display_order)
  SELECT
    p_user_id,
    seed.name,
    seed.input_type,
    seed.unit,
    seed.scheduled_days,
    seed.display_order
  FROM (
    VALUES
      ('Sleep', 'number', 'hours', ARRAY[1,2,3,4,5,6,0]::integer[], 0),
      ('Exercise / movement', 'boolean', NULL, ARRAY[1,2,3,4,5,6,0]::integer[], 1),
      ('Focused work', 'duration', 'minutes', ARRAY[1,2,3,4,5,6,0]::integer[], 2),
      ('Personal habit', 'boolean', NULL, ARRAY[1,2,3,4,5,6,0]::integer[], 3)
  ) AS seed(name, input_type, unit, scheduled_days, display_order)
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_habits existing
    WHERE existing.user_id = p_user_id
      AND existing.name = seed.name
      AND existing.is_archived = false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seed_default_habits_for_user(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS habit_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id uuid NOT NULL REFERENCES user_habits(id) ON DELETE CASCADE,
  checkin_date date NOT NULL,
  value_boolean boolean,
  value_number numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, habit_id, checkin_date)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'habit_checkins_single_value_check'
  ) THEN
    ALTER TABLE habit_checkins
      ADD CONSTRAINT habit_checkins_single_value_check
      CHECK (
        (value_boolean IS NOT NULL AND value_number IS NULL)
        OR (value_boolean IS NULL AND value_number IS NOT NULL)
        OR (value_boolean IS NULL AND value_number IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_habit_checkins_user_date
  ON habit_checkins(user_id, checkin_date);

ALTER TABLE habit_checkins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'habit_checkins'
      AND policyname = 'Users can manage their own habit checkins'
  ) THEN
    CREATE POLICY "Users can manage their own habit checkins"
      ON habit_checkins
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION replace_daily_action_reviews(
  p_user_id uuid,
  p_session_id uuid,
  p_review_date date,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM daily_action_reviews
  WHERE user_id = p_user_id
    AND review_date = p_review_date;

  INSERT INTO daily_action_reviews (
    user_id,
    session_id,
    review_date,
    plan_action_id,
    action_text,
    completion_measure,
    outcome,
    is_primary,
    display_order
  )
  SELECT
    p_user_id,
    p_session_id,
    p_review_date,
    NULLIF(row.plan_action_id, '')::uuid,
    row.action_text,
    NULLIF(row.completion_measure, ''),
    row.outcome,
    row.is_primary,
    row.display_order
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
    plan_action_id text,
    action_text text,
    completion_measure text,
    outcome text,
    is_primary boolean,
    display_order integer
  );
END;
$$;

GRANT EXECUTE ON FUNCTION replace_daily_action_reviews(uuid, uuid, date, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION replace_daily_plan_actions(
  p_user_id uuid,
  p_session_id uuid,
  p_plan_date date,
  p_rows jsonb
)
RETURNS SETOF daily_plan_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM daily_plan_actions
  WHERE user_id = p_user_id
    AND plan_date = p_plan_date;

  INSERT INTO daily_plan_actions (
    user_id,
    session_id,
    plan_date,
    action_text,
    completion_measure,
    minimum_version,
    stretch_version,
    is_primary,
    display_order,
    is_published
  )
  SELECT
    p_user_id,
    p_session_id,
    p_plan_date,
    row.action_text,
    NULLIF(row.completion_measure, ''),
    NULLIF(row.minimum_version, ''),
    NULLIF(row.stretch_version, ''),
    row.is_primary,
    row.display_order,
    TRUE
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
    action_text text,
    completion_measure text,
    minimum_version text,
    stretch_version text,
    is_primary boolean,
    display_order integer
  );

  RETURN QUERY
  SELECT *
  FROM daily_plan_actions
  WHERE user_id = p_user_id
    AND plan_date = p_plan_date
  ORDER BY display_order ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_daily_plan_actions(uuid, uuid, date, jsonb) TO authenticated;
