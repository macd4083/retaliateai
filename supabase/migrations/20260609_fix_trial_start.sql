ALTER TABLE user_profiles
  ALTER COLUMN subscription_status SET DEFAULT 'trialing';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, created_at, updated_at, trial_ends_at)
  VALUES (new.id, now(), now(), now() + interval '7 days')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

UPDATE public.user_profiles
SET trial_ends_at = COALESCE(created_at, now()) + interval '7 days'
WHERE trial_ends_at IS NULL
  AND subscription_status = 'trialing';
