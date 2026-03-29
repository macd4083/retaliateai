# Reflection Simulator

Simulates months of nightly reflection sessions end-to-end to test coaching quality, data tracking, and insight generation.

## How It Works

The simulator calls `api/reflection-coach.js` directly as a function (no running server needed). The entire real pipeline fires: GPT-4o coaching, intent classification, DB writes, profile evolution, embeddings, follow-up queuing, and growth markers.

For each simulated day it:
1. Creates a `reflection_sessions` row in Supabase for that date
2. Sends `__INIT__` to get the coach's opening message
3. Uses GPT-4o-mini to generate realistic persona-appropriate responses
4. Loops through ~8–12 turns until `is_session_complete: true` or a max turn limit
5. Scores each coach message for quality (1–5) using GPT-4o-mini
6. Writes `simulation-report.json` with full session data and flagged messages

---

## Setup

### 1. Create a dedicated test user in Supabase

- Go to **Supabase Dashboard → Authentication → Users**
- Click **Add user → Create new user**
- Email: `test-sim@retaliateai.dev`, any password
- Copy the UUID that appears — you'll need it for step 2

### 2. Set up your environment file

```bash
cp scripts/.env.simulation .env.simulation.local
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, SIM_USER_ID
```

### 3. Set up the test user's profile

Run this SQL in the **Supabase SQL editor**, replacing the UUID with your test user's UUID:

```sql
INSERT INTO user_profiles (id, display_name, full_name, big_goal, why, future_self, identity_statement, life_areas, blockers)
VALUES (
  'your-uuid-here',
  'Alex',
  'Alex (Sim)',
  'Launch my SaaS to $5k MRR by end of year',
  'I want to prove I can build something real and stop talking about it',
  'In a year I''m running a profitable product and don''t need a job',
  'I''m someone who builds things that matter',
  ARRAY['work', 'fitness', 'relationships'],
  ARRAY['perfectionism', 'distraction', 'fear of shipping']
) ON CONFLICT (id) DO NOTHING;
```

For the `consistent_grinder` or `creative_with_perfectionism` personas, adjust the values to match the persona defined in `scripts/personas.js`.

---

## Running the Simulator

### Basic run (30 days, default persona)

```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js
```

### With options

```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --days 90 \
  --start-date 2025-12-01 \
  --persona consistent_grinder
```

### Available options

| Flag | Default | Description |
|------|---------|-------------|
| `--days` | `30` | Number of days to simulate |
| `--start-date` | 30 days ago | Start date (YYYY-MM-DD) |
| `--persona` | `ambitious_but_inconsistent` | Which persona to use |
| `--clean` | `false` | **Recommended.** Wipes all previous sim data for `SIM_USER_ID` and resets the user profile to the persona definition before running. Without this, leftover patterns and profile data from prior runs will contaminate the coach's context. |
| `--test-why-building` | `false` | Runs a focused **7-day** simulation specifically testing why evolution (see below). |
| `--test-goal-suggestion` | `false` | Runs a **single-session** test that checks whether the coach suggests a new goal and validates the full suggestion → acceptance → why-journaling flow (see below). |

## Why `--clean` matters

The reflection coach reads 7 Supabase tables before every response — including accumulated patterns, an AI-evolved user profile, and queued follow-up questions. If `SIM_USER_ID` has leftover data from a previous run, the coach starts Day 1 already "knowing" the user, which defeats the purpose of the simulation.

Always use `--clean` when running a fresh test. A snapshot of your pre-run profile is saved to `report.meta.pre_run_profile_snapshot` so you can restore it if needed.

**Example:**
```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --days 7 \
  --start-date 2026-03-14 \
  --persona ambitious_but_inconsistent \
  --clean
```

---

## `--test-why-building`

Runs a focused **7-day** simulation specifically testing how whys evolve over time:

- **Day 1**: User has a goal with a shallow why ("I just want to make money")
- **Day 3**: Coach runs `why_reconnect` exercise; user gives a deeper answer → why is updated or added
- **Day 5**: User mentions a *new* reason → AI detects it's distinct and adds a second why
- **Day 7**: Coach runs motivation check-in, should reference *specific* whys, not generic language

**Output**: `scripts/why-building-report.json` with full why evolution history and pass/fail assertions.

**Example:**
```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --persona ambitious_but_inconsistent \
  --start-date 2026-03-14 \
  --clean \
  --test-why-building
```

**Assertions checked:**
- Day 1 — shallow why present in DB
- Day 3 — `why_reconnect` exercise fired
- Day 3 — why evolved (count changed)
- Day 5 — additive why detected (goals has 2+ whys)
- Day 7 — coach referenced a specific why text from the whys list

---

## `--test-goal-suggestion`

Runs a **single-session** test that validates the full goal suggestion flow:

1. Simulates a session where the coach surfaces a suggested goal via `extracted_data.goal_suggestion`
2. Accepts the suggested goal (calls `api/create-goal.js`)
3. Journals a why for the new goal
4. Verifies the new goal appears in the DB with at least one why entry

**Output**: Pass/fail assertions to console.

**Example:**
```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --persona ambitious_but_inconsistent \
  --start-date 2026-03-14 \
  --clean \
  --test-goal-suggestion
```

**Assertions checked:**
- Session completed
- Goal suggestion fired in extracted_data
- Goal created in Supabase
- Goal has a why entry

> **Note:** Goal suggestion requires the AI to naturally surface one in a single session. If it doesn't fire, try running without `--clean` so the coach has more context, or run multiple days first.

---

### Available personas

| Key | Name | Description | Why Pool |
|-----|------|-------------|----------|
| `ambitious_but_inconsistent` | Alex | Building SaaS, ~60% follow-through | ✅ shallow / deeper / additive |
| `consistent_grinder` | Jordan | Consistent but surface-level, ~85% follow-through | ✅ shallow / deeper / additive |
| `creative_with_perfectionism` | Sam | Deep reflector but struggles to commit, ~50% follow-through | ✅ shallow / deeper / additive |
| `burnt_out_professional` | Maya | Corporate PM building a side project, ~55% follow-through | — (no goals seeded by default) |
| `comeback_kid` | Darius | Recovering from burnout, cautious optimist, ~70% follow-through | — (no goals seeded by default) |

The three primary personas (`ambitious_but_inconsistent`, `consistent_grinder`, `creative_with_perfectionism`) have `whyPool` defined with tiered responses. The why tier is selected based on the day number:
- Days 1–7: `shallow` (surface-level answers)
- Days 8–20: `deeper` (emotionally honest, realizing the real reason)
- Days 21+: `additive` (60% chance) or `deeper` (40% chance)

---

## Terminal Output

```
━━━ DAY 1 — 2025-12-01 ━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖  Hey, it's getting late — how are you feeling tonight?
👤  Proud 🔥
🤖  Love that — what happened today that's got you feeling proud?
👤  I finally shipped the landing page I've been putting off for two weeks
    ↳ Quality: 5/5
🤖  Two weeks of putting it off and you shipped it — that's the win right there. What made today different?
...
✅  Complete | Stage: close | Exercises: depth_probe | Turns: 9
```

---

## Reviewing Results

After the run completes, open `scripts/simulation-report.json`.

### What to look at in the app

Log in as your test user and check:
- **Insights page** — are patterns being detected correctly?
- **Profile** — is `short_term_state` evolving realistically?
- **Reflection history** — do sessions feel coherent?

### Sharing flagged issues with Copilot

1. Open `simulation-report.json`
2. Find the `flagged_for_review` array at the bottom
3. Copy the flagged entries you want to fix
4. Paste them in a Copilot chat and say:
   > "Here are flagged coach messages from the simulator — can you fix the system prompt?"

Copilot will look at the flag reasons, cross-reference with `api/reflection-coach.js` SYSTEM_PROMPT, and write the fix.

---

## Flag Types

| Flag | Meaning | Where to fix |
|------|---------|-------------|
| `GENERIC` | Didn't use user's actual words/context | SYSTEM_PROMPT core rules |
| `THERAPIST_LANGUAGE` | "How does that make you feel" etc. | SYSTEM_PROMPT personality |
| `TWO_QUESTIONS` | Asked more than one question | SYSTEM_PROMPT core rules |
| `VALIDATED_EXCUSE` | Let user off the hook | ANTI-EXCUSE SYSTEM section |
| `REPEATED_TOPIC` | Re-asked something already answered | ON KNOWING WHEN TO CLOSE section |
| `WEAK_DEPTH` | Missed a depth opportunity | SELF-REFLECTION PRIORITY section |
| `OFF_STAGE` | Wrong stage for context | Stage advancement logic |
| `TOO_LONG` | More than 3 sentences | SYSTEM_PROMPT personality |

---

## Report Structure

`simulation-report.json` contains:

```json
{
  "meta": { "persona": "...", "start_date": "...", "days_simulated": 30, "user_id": "...", "run_at": "..." },
  "summary": {
    "total_turns": 247,
    "avg_quality_score": 3.8,
    "sessions_completed": 28,
    "sessions_incomplete": 2,
    "flags_by_type": { "GENERIC": 12, "THERAPIST_LANGUAGE": 3 },
    "avg_why_deepening_quality": 3.4,
    "why_evolution_events": 4,
    "goals_with_multiple_whys": 2
  },
  "sessions": [
    {
      "date": "2025-12-01",
      "session_id": "...",
      "completed": true,
      "turns": 9,
      "avg_quality": 4.1,
      "exercises_run": ["depth_probe"],
      "checklist": { "wins": true, "honest": true, "plan": true, "identity": true },
      "goals_why_snapshot": [
        {
          "goal_title": "Get Stackline to 20 paying customers",
          "whys_count": 2,
          "latest_why": "It stopped being about the product — it's about proving I'm someone who finishes things.",
          "session_avg_why_deepening_quality": 4
        }
      ],
      "conversation": [...]
    }
  ],
  "flagged_for_review": [...]
}
```

### `summary` why fields

| Field | Description |
|-------|-------------|
| `avg_why_deepening_quality` | Average why-deepening quality score (1–5) across all turns where it was scored. `null` if no why questions were asked. |
| `why_evolution_events` | Total number of sessions where a goal's why was added or replaced. |
| `goals_with_multiple_whys` | Number of active goals that ended the simulation with 2+ whys. |

### `goals_why_snapshot` per session

Each session record now includes a `goals_why_snapshot` array — one entry per active goal:

| Field | Description |
|-------|-------------|
| `goal_title` | Goal title |
| `whys_count` | How many whys are in the goal's `whys[]` array at end of this session |
| `latest_why` | The text of the most recently added/updated why |
| `session_avg_why_deepening_quality` | Session-wide average why-deepening score from all coach messages in this session (not goal-specific) |

---

## `why-building-report.json`

When you run `--test-why-building`, a separate `scripts/why-building-report.json` is written with:

```json
{
  "meta": { "persona": "...", "start_date": "...", "run_at": "..." },
  "assertions": {
    "day1_shallow_why_present": true,
    "day3_why_reconnect_fired": true,
    "day3_why_evolved": true,
    "day5_additive_why_detected": false,
    "day7_specific_why_referenced": true
  },
  "why_evolution_history": [
    { "goal_id": "...", "goal_title": "...", "event": "added", "prev_count": 0, "new_count": 1, "date": "2026-03-16" }
  ],
  "summary": {
    "total_why_evolution_events": 3,
    "final_whys_per_goal": [
      { "goal_id": "...", "title": "...", "whys_count": 2, "whys": [...] }
    ]
  },
  "days": [...]
}
```

---

## Cost Estimate

| Run | GPT-4o turns (coach) | GPT-4o-mini turns | Est. cost |
|-----|---------------------|-------------------|-----------|
| 30 days | ~270 | ~540 | ~$2–4 |
| 90 days | ~810 | ~1,620 | ~$6–12 |
| `--test-why-building` | ~63 | ~126 | ~$0.50–1 |
| `--test-goal-suggestion` | ~9 | ~18 | ~$0.15 |

> **Tip:** Use `--days 3` for a quick smoke test before a full run.
