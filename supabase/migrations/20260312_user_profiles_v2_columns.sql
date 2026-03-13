-- Add V2 onboarding columns to user_profiles
alter table user_profiles
  add column if not exists full_name text,
  add column if not exists future_self text,
  add column if not exists big_goal text,
  add column if not exists why text,
  add column if not exists identity_statement text,
  add column if not exists blockers jsonb default '[]',
  add column if not exists life_areas jsonb default '[]',
  add column if not exists preferred_reflection_time time default '21:00',
  add column if not exists timezone text default 'America/New_York',
  add column if not exists onboarding_step int default 1;

-- Add why_it_matters column to goals table
alter table goals
  add column if not exists why_it_matters text;
