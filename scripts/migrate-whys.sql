-- Migration: Add whys array column to goals table
-- Run this once in your Supabase SQL editor before deploying the new code.

ALTER TABLE goals ADD COLUMN IF NOT EXISTS whys jsonb DEFAULT '[]'::jsonb;

-- Optional: seed whys from existing why_it_matters for all goals that have it
-- but have no whys yet. Safe to run multiple times.
UPDATE goals
SET whys = jsonb_build_array(
  jsonb_build_object(
    'text', why_it_matters,
    'added_at', NULL,
    'source', 'original',
    'motivation_signal', NULL,
    'session_id', NULL
  )
)
WHERE why_it_matters IS NOT NULL
  AND (whys IS NULL OR whys = '[]'::jsonb);
