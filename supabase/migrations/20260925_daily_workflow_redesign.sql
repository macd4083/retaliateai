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

CREATE POLICY IF NOT EXISTS "Users can manage their own daily plan actions"
  ON daily_plan_actions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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

CREATE POLICY IF NOT EXISTS "Users can manage their own daily action reviews"
  ON daily_action_reviews
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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

ALTER TABLE user_habits ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can manage their own habits"
  ON user_habits
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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

CREATE INDEX IF NOT EXISTS idx_habit_checkins_user_date
  ON habit_checkins(user_id, checkin_date);

ALTER TABLE habit_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can manage their own habit checkins"
  ON habit_checkins
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
