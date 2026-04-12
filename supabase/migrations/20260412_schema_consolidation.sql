-- Migration: 20260412_schema_consolidation.sql
-- 
-- Case 1: Migrate goals.why_it_matters → goals.whys[] and drop the column.
-- Case 2: Add first_seen_date/last_seen_date to user_insights, migrate data
--         from reflection_patterns, then drop reflection_patterns.
--
-- Safe to run multiple times where guarded by IF NOT EXISTS / IF EXISTS.

-- ─────────────────────────────────────────────────────────────────────────────
-- CASE 1: goals.why_it_matters → goals.whys[]
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. Seed whys[0] from why_it_matters for every goal that has it but whose
--     whys array is empty or has no source:'original' entry yet.
UPDATE goals
SET whys = jsonb_build_array(
  jsonb_build_object(
    'text',              why_it_matters,
    'added_at',          created_at,
    'source',            'original',
    'motivation_signal', NULL,
    'session_id',        NULL
  )
) || COALESCE(
  (SELECT jsonb_agg(elem)
   FROM jsonb_array_elements(whys) AS elem
   WHERE (elem->>'source') IS DISTINCT FROM 'original'),
  '[]'::jsonb
)
WHERE why_it_matters IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(whys, '[]'::jsonb)) AS w
    WHERE w->>'source' = 'original'
  );

-- 1b. Drop why_it_matters column (the data is now in whys[]).
ALTER TABLE goals DROP COLUMN IF EXISTS why_it_matters;

-- ─────────────────────────────────────────────────────────────────────────────
-- CASE 2: Add first_seen_date / last_seen_date to user_insights
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a. Add the new date columns.
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS first_seen_date DATE;
ALTER TABLE user_insights ADD COLUMN IF NOT EXISTS last_seen_date  DATE;

-- 2b. For each reflection_patterns row, find matching user_insights by user + label
--     and populate first_seen_date / last_seen_date where the insight row exists
--     but those fields are still null.
UPDATE user_insights ui
SET
  first_seen_date = COALESCE(ui.first_seen_date, rp.first_seen_date),
  last_seen_date  = COALESCE(ui.last_seen_date,  rp.last_seen_date)
FROM reflection_patterns rp
WHERE ui.user_id       = rp.user_id
  AND ui.pattern_label = rp.label
  AND ui.is_active     = TRUE
  AND (ui.first_seen_date IS NULL OR ui.last_seen_date IS NULL);

-- 2c. For user_insights rows that still have no first_seen_date, default to
--     synthesized_at (best available proxy for when the pattern was first noticed).
UPDATE user_insights
SET
  first_seen_date = synthesized_at::date,
  last_seen_date  = COALESCE(last_seen_date, synthesized_at::date)
WHERE first_seen_date IS NULL
  AND is_active = TRUE;

-- 2d. Drop reflection_patterns — user_insights is now the sole source of truth.
DROP TABLE IF EXISTS reflection_patterns;
