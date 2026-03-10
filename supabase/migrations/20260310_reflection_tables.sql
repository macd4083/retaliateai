-- Reflection Sessions table
create table reflection_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null default current_date,

  -- Stage tracking
  current_stage text not null default 'wins', -- wins | honest | tomorrow | close | complete
  is_complete boolean not null default false,

  -- State snapshots (updated as session progresses)
  mood_end_of_day text, -- proud | grateful | okay | guilty | stressed | tired
  energy_level int check (energy_level between 1 and 10),
  stress_level int check (stress_level between 1 and 10),

  -- Stage 1 data
  wins jsonb default '[]', -- [{text, area_tag, created_at}]
  gratitude_entries jsonb default '[]', -- [{text}]

  -- Stage 2 data
  misses jsonb default '[]', -- [{text, area_tag}]
  blocker_tags text[] default '{}', -- phone_social | low_energy | anxiety | no_plan | perfectionism | overcommitted | other
  self_honesty_notes text,
  internal_dialogue text, -- what were they telling themselves

  -- Stage 3 data
  tomorrow_commitment text,
  commitment_why text,
  commitment_realism_score int check (commitment_realism_score between 1 and 10),
  tomorrow_plan_details jsonb, -- {what, when, where, linked_goal_id}

  -- Stage 4 data
  self_compassion_note text,
  self_hype_message text, -- shown back next session

  -- Metadata
  reflection_streak int default 0,
  session_duration_seconds int,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table reflection_sessions enable row level security;
create policy "Users can manage their own reflection sessions"
  on reflection_sessions for all using (auth.uid() = user_id);

create index idx_reflection_sessions_user_date
  on reflection_sessions(user_id, date desc);

-- Reflection Messages table
create table reflection_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references reflection_sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,

  role text not null check (role in ('assistant', 'user', 'system')),
  content text not null,

  -- For AI messages
  stage text, -- wins | honest | tomorrow | close
  message_type text, -- question | reflection | affirmation | summary_card | chip_prompt
  chips jsonb, -- [{label, value, emoji}] for quick-reply options

  -- For user messages
  chip_selected text, -- if they tapped a chip

  -- Structured data extracted from this message
  extracted_data jsonb, -- any structured fields the AI extracted

  created_at timestamptz not null default now()
);

alter table reflection_messages enable row level security;
create policy "Users can manage their own reflection messages"
  on reflection_messages for all using (auth.uid() = user_id);

create index idx_reflection_messages_session
  on reflection_messages(session_id, created_at asc);

-- Reflection Patterns table
create table reflection_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  pattern_type text not null, -- blocker | win_pattern | energy_pattern | identity_theme
  label text not null,
  description text,

  occurrence_count int not null default 1,
  last_seen_date date not null default current_date,
  first_seen_date date not null default current_date,

  trend text default 'stable', -- increasing | stable | decreasing

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table reflection_patterns enable row level security;
create policy "Users can manage their own reflection patterns"
  on reflection_patterns for all using (auth.uid() = user_id);

create index idx_reflection_patterns_user
  on reflection_patterns(user_id, last_seen_date desc);

-- Life Areas table
create table life_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  label text not null, -- e.g. "Classes", "Side Project", "Health"
  emoji text,
  priority_level text default 'medium', -- low | medium | high
  why_this_matters text,

  is_active boolean not null default true,
  display_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table life_areas enable row level security;
create policy "Users can manage their own life areas"
  on life_areas for all using (auth.uid() = user_id);
