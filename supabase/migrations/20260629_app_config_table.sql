-- Migration: 20260629_app_config_table.sql
--
-- Creates a shared app_config key/value store for runtime feature flags.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.app_config (
  key          text        NOT NULL,
  value        jsonb       NOT NULL DEFAULT 'null'::jsonb,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        REFERENCES auth.users(id),
  CONSTRAINT app_config_pkey PRIMARY KEY (key)
);

INSERT INTO public.app_config (key, value, description)
VALUES (
  'guest_guardrails_enabled',
  'true'::jsonb,
  '2-day access window + 7-day cooldown policy for guest campaign users. Set false to bypass all guest timing gates.'
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read app config" ON public.app_config;
CREATE POLICY "Authenticated users can read app config"
  ON public.app_config FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage app config" ON public.app_config;
CREATE POLICY "Admins can manage app config"
  ON public.app_config FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
