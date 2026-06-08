-- Allow admins to read ALL user feedback (not just their own)
DROP POLICY IF EXISTS "Admins can view all feedback" ON user_feedback;
CREATE POLICY "Admins can view all feedback"
  ON user_feedback FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Allow admins to delete any feedback entry
DROP POLICY IF EXISTS "Admins can delete all feedback" ON user_feedback;
CREATE POLICY "Admins can delete all feedback"
  ON user_feedback FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
