-- Guest campaign onboarding flow columns
-- Supports Instagram-traffic guest users who complete their first session without signup.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_guest_campaign_user boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_first_session boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_signup_for_next_session boolean DEFAULT false,
  -- Stores src + UTM params captured on /start/guest entry
  ADD COLUMN IF NOT EXISTS campaign_attribution jsonb DEFAULT '{}';
