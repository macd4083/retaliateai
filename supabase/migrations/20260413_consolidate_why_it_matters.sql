-- Migration: 20260413_consolidate_why_it_matters.sql
--
-- Drops the legacy goals.why_it_matters column.
-- The data has already been seeded into goals.whys[] by:
--   20260412_seed_whys_from_why_it_matters.sql
--
-- Safe to run multiple times (guarded by IF EXISTS).

ALTER TABLE goals DROP COLUMN IF EXISTS why_it_matters;
