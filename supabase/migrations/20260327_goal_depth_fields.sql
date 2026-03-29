ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS enriched_why TEXT,
  ADD COLUMN IF NOT EXISTS vision_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS depth_insights JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_mentioned_at DATE,
  ADD COLUMN IF NOT EXISTS suggested_next_action TEXT;
