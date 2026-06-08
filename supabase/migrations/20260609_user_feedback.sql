CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  q1_favorite_least_favorite text,
  q2_whats_working text,
  submitted_at timestamptz DEFAULT now(),
  trial_extended boolean DEFAULT true
);

ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own feedback" ON user_feedback;
CREATE POLICY "Users can insert own feedback"
  ON user_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own feedback" ON user_feedback;
CREATE POLICY "Users can view own feedback"
  ON user_feedback FOR SELECT
  USING (auth.uid() = user_id);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS feedback_submitted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_extended boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_trial_email_sent_at timestamptz;
