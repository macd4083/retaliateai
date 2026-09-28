-- Today V2 workflow schema
-- Idempotent migration for daily review, follow-through, habits, and planning.

CREATE TABLE IF NOT EXISTS public.v2_daily_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_date date NOT NULL DEFAULT current_date,
  desired_direction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_daily_reviews_user_date_unique UNIQUE (user_id, review_date)
);

CREATE TABLE IF NOT EXISTS public.v2_planned_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_date date NOT NULL,
  action_text text NOT NULL,
  action_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_planned_actions_user_order_unique UNIQUE (user_id, review_date, action_order)
);

CREATE TABLE IF NOT EXISTS public.v2_follow_through_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_date date NOT NULL,
  source_action_id uuid REFERENCES public.v2_planned_actions(id) ON DELETE SET NULL,
  action_text text NOT NULL,
  action_order integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_follow_through_items_user_action_unique UNIQUE (user_id, review_date, action_text, action_order)
);

CREATE TABLE IF NOT EXISTS public.v2_habit_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  habit_type text NOT NULL CHECK (habit_type IN ('boolean', 'number')),
  unit text,
  weekdays smallint[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.v2_habit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id uuid NOT NULL REFERENCES public.v2_habit_definitions(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT current_date,
  boolean_value boolean,
  number_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_habit_logs_user_habit_date_unique UNIQUE (user_id, habit_id, log_date)
);

ALTER TABLE public.v2_daily_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_planned_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_follow_through_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_habit_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_habit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own v2 daily reviews" ON public.v2_daily_reviews;
CREATE POLICY "Users manage own v2 daily reviews"
  ON public.v2_daily_reviews
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own v2 planned actions" ON public.v2_planned_actions;
CREATE POLICY "Users manage own v2 planned actions"
  ON public.v2_planned_actions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own v2 follow through" ON public.v2_follow_through_items;
CREATE POLICY "Users manage own v2 follow through"
  ON public.v2_follow_through_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own v2 habit definitions" ON public.v2_habit_definitions;
CREATE POLICY "Users manage own v2 habit definitions"
  ON public.v2_habit_definitions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own v2 habit logs" ON public.v2_habit_logs;
CREATE POLICY "Users manage own v2 habit logs"
  ON public.v2_habit_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_v2_daily_reviews_user_date
  ON public.v2_daily_reviews(user_id, review_date DESC);

CREATE INDEX IF NOT EXISTS idx_v2_planned_actions_user_date
  ON public.v2_planned_actions(user_id, review_date DESC, action_order ASC);

CREATE INDEX IF NOT EXISTS idx_v2_follow_through_user_date
  ON public.v2_follow_through_items(user_id, review_date DESC, action_order ASC);

CREATE INDEX IF NOT EXISTS idx_v2_habit_definitions_user_archived
  ON public.v2_habit_definitions(user_id, is_archived);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_habit_definitions_user_name
  ON public.v2_habit_definitions(user_id, name);

CREATE INDEX IF NOT EXISTS idx_v2_habit_logs_user_date
  ON public.v2_habit_logs(user_id, log_date DESC);

CREATE OR REPLACE FUNCTION public.seed_default_habits_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.v2_habit_definitions (user_id, name, habit_type, unit, weekdays, is_archived)
  VALUES
    (p_user_id, 'Sleep', 'number', 'hours', ARRAY[0,1,2,3,4,5,6], false),
    (p_user_id, 'Exercise/movement', 'boolean', NULL, ARRAY[0,1,2,3,4,5,6], false),
    (p_user_id, 'Focused work', 'number', 'minutes', ARRAY[0,1,2,3,4,5,6], false)
  ON CONFLICT (user_id, name)
  DO UPDATE SET
    habit_type = EXCLUDED.habit_type,
    unit = EXCLUDED.unit,
    weekdays = EXCLUDED.weekdays,
    is_archived = false,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_habits_for_user(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
