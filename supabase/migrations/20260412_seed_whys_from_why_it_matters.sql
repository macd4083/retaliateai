-- Migration: 20260412_seed_whys_from_why_it_matters.sql
-- Ensures the whys JSONB column exists on goals.
-- Seeds whys[0] from why_it_matters for any goal that has it but no whys yet.
-- Safe to run multiple times.

ALTER TABLE goals ADD COLUMN IF NOT EXISTS whys jsonb DEFAULT '[]'::jsonb;

UPDATE goals
SET whys = jsonb_build_array(
  jsonb_build_object(
    'text',              why_it_matters,
    'added_at',          NULL,
    'source',            'original',
    'motivation_signal', NULL,
    'session_id',        NULL
  )
)
WHERE why_it_matters IS NOT NULL
  AND (whys IS NULL OR whys = '[]'::jsonb);
