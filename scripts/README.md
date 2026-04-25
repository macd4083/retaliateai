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
| `--scenario` | `mixed` | Commitment follow-through arc. Options: `kept_streak`, `miss_streak`, `mixed`, `cold_start`, `bridge_kept_streak`, `bridge_miss_streak` (see below) |
| `--dry-run` | `false` | Run only 1 day, print the full conversation to stdout, and exit without writing the report JSON. Useful for fast sanity checks. |
| `--report-path` | `scripts/simulation-report.json` | Custom output path for the report JSON |
| `--test-why-building` | `false` | Runs a focused **7-day** simulation specifically testing why evolution (see below). |
| `--test-goal-suggestion` | `false` | Runs a **single-session** test that checks whether the coach suggests a new goal and validates the full suggestion → acceptance → why-journaling flow (see below). |
| `--test-full-coverage` | `false` | Runs a **21-day** simulation with explicit pass/fail assertions for every major feature. Outputs `full-coverage-report.json` (see below). |
| `--assert-week N` | — | Reads an existing `full-coverage-report.json` and re-checks assertions for week N (1, 2, or 3). Useful for re-grading without re-running the full simulation. |

### `--scenario` options

| Value | Behavior |
|-------|----------|
| `kept_streak` | Biases every day toward follow-through on yesterday's commitment (`followedThrough: true`). Good for testing the happy path through `commitment_checkin`. |
| `miss_streak` | Biases every day toward missing commitments (`followedThrough: false`). Tests how the coach responds to repeated non-follow-through. |
| `mixed` | Alternates realistically — after a kept commitment the user is more likely to miss the next, and vice versa. This is the default and most realistic arc. |
| `cold_start` | Simulates a user who has never used the app before — no yesterday commitment, no streak. The `commitment_checkin` stage never fires. |
| `bridge_kept_streak` | Like `kept_streak`, but persona events are biased toward goal-linked commitments that get kept. Designed to trigger `wins_goal_callback` regularly. Tests the bridge → wins feedback loop. |
| `bridge_miss_streak` | Like `miss_streak`, but persona events are biased toward goal-linked commitments that get missed. Designed to trigger `honest_commitment_miss` frequently. Tests the accountability loop. |

### `--dry-run`

Runs only day 1, prints the full conversation to stdout, and exits without writing any report JSON. Useful for quickly verifying the simulator is wired correctly before a long run:

```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --persona consistent_grinder \
  --clean \
  --dry-run
```

### `--report-path`

Write the simulation report to a custom location instead of the default `scripts/simulation-report.json`:

```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --days 90 \
  --report-path /tmp/sim-run-2026-04.json
```

## Why `--clean` matters

The reflection coach reads 7 Supabase tables before every response — including accumulated patterns, an AI-evolved user profile, and queued follow-up questions. If `SIM_USER_ID` has leftover data from a previous run, the coach starts Day 1 already "knowing" the user, which defeats the purpose of the simulation.

Always use `--clean` when running a fresh test. A snapshot of your pre-run profile is saved to `report.meta.pre_run_profile_snapshot` so you can restore it if needed.

**New `--clean` behavior (added in this update):** After seeding the persona's goals, `--clean` now reads back the inserted goal rows from the DB and stores their Supabase UUIDs in `crossSessionState.goalIds` (keyed by goal title). This enables `goal_commitment_log` assertions to verify that `goal_id` is correctly set when commitment fragments are logged.

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
- Day 3 — a `commitment_planning` why written to `goals.whys` (bridge fired and answer was captured)
- Day 5 — additive why detected (goals has 2+ whys)
- Day 5 — `why_summary` populated for at least one goal
- Day 5 — `commitment_planning` whys still at most 1 per goal (pruning enforcement)
- Day 7 — coach referenced a specific why text from the whys list
- Day 7 — `commitment_planning` whys still bounded at max 1 after multiple sessions

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

## `--test-full-coverage`

Runs a **21-day** simulation that exercises every major feature of the coaching pipeline, including behaviours that only emerge after sustained usage (week 2 patterns, week 3 why references, growth markers, etc.).

**Usage:**
```bash
node --env-file=.env.simulation.local scripts/simulate-reflection.js \
  --persona ambitious_but_inconsistent \
  --start-date 2026-01-01 \
  --clean \
  --test-full-coverage
```

**Output:** `scripts/full-coverage-report.json` (see structure below), plus a printed summary:

```
════════════════════════════════════════════════════
📋  FULL COVERAGE REPORT
════════════════════════════════════════════════════
✅ PASS  Session row inserted every simulated day
✅ PASS  __INIT__ turn fires and returns assistant_message
✅ PASS  All 4 checklist stages complete in at least 1 session
❌ FAIL  growth_markers row exists after 14+ days
...
Exercise coverage: 6/8 exercises fired at least once
  Missing: commitment_deepening, accountability_mirror

Result: 30/38 assertions passed
════════════════════════════════════════════════════
```

### Assertions checked

The run verifies assertions across 21 feature areas:

| Category | Assertions |
|----------|------------|
| **Core session flow** | Session created, INIT fires, all 4 checklist stages complete, session_complete before max turns, stage sequence recorded |
| **Commitment check-in** | commitment_checkin fires on day 2+, commitment_checkin_done flips, miss_rate computed |
| **Exercises** | All 8 exercises fire at least once: `why_reconnect`, `identity_reinforcement`, `future_self_visualization`, `reframe_failure`, `values_clarification`, `pattern_interrupt`, `commitment_deepening`, `accountability_mirror` |
| **Goals** | Goal row exists with correct fields, goal_suggestion detected, last_mentioned_at updated, whys[] evolution, commitment extraction, commitment stats, commitment evaluation |
| **Commitment stats** | followThrough7 non-null after day 2, trajectory valid value, trajectory non-null after 14 days |
| **Patterns & narrative** | ≥1 pattern after 5 sessions, ≥2 repeating patterns after 10 sessions, narrative produced after 10 sessions |
| **Embeddings** | generate-embedding returns vector with length > 100 |
| **Profile evolution** | short_term_state after 7 days, strengths after 14 days, growth_areas after 14 days, identity_statement preserved |
| **Follow-up queue** | Queue populated after commitment, rows have future due_date |
| **Growth markers** | ≥1 growth_markers row after 14+ days |
| **Intent classification** | classify-intent returns valid intent string |
| **Week 1 (days 1–7)** | Patterns bounded (0–2 entries), why_reconnect fired |
| **Week 2 (days 8–14)** | ≥1 repeating pattern, short_term_state populated, goals/strengths/growth_areas milestone |
| **Week 3 (days 15–21)** | Coach references specific whys, growth marker + narrative + trait grade milestone |
| **Bridge directives (new)** | `commitment_goal_bridge` fired by day 7, `commitment_goal_why_depth` fired by day 7, `commitment_goal_bridge_done: true` set by day 7, `goal_why_insight` with `source:commitment_planning` written by day 7, `why_summary` populated for ≥1 goal by day 10 |
| **Wins-goal callback (new)** | `wins_goal_callback` directive fired at least once in the first 14 days |
| **Honest miss grounding (new)** | `honest_commitment_miss` directive fired at least once in a session with a missed commitment |
| **Progress feeling (new)** | `progress_feeling` extracted at least once by day 14, written to `goals.depth_insights` by day 14 |
| **Plan checklist gating (new)** | `plan` checklist flag never set `true` without a real `tomorrow_commitment` in `extracted_data` |
| **Tomorrow routing (new)** | `tomorrow → complete` never reached without `commitment_goal_bridge_done: true`; emergency close (≥20 turns) never fires in a normal session |
| **Whys pruning (new)** | `goals.whys` never has >1 entry with `source:commitment_planning` per goal; `goals.whys` never exceeds 5 entries total for any goal |

### `full-coverage-report.json` structure

```json
{
  "meta": { "persona": "...", "start_date": "...", "days_simulated": 21, "run_at": "..." },
  "summary": {
    "sessions_completed": 19,
    "sessions_incomplete": 2,
    "commitment_checkin_coverage": { "fired": 15, "resolved": 14, "should_have_fired": 17, "miss_rate": "12%" }
  },
  "coverage_assertions": [
    {
      "id": "session_created_daily",
      "description": "Session row inserted every simulated day",
      "passed": true,
      "day_first_passed": 1,
      "notes": null
    }
  ],
  "exercise_coverage": {
    "fired": ["why_reconnect", "identity_reinforcement", "..."],
    "total": 8,
    "coverage_count": 6
  },
  "backend_summary": { "..." },
  "sessions": [ { "day": 1, "..." } ],
  "trait_detection": { "..." }
}
```

---

## `--assert-week N`

Re-checks week N assertions from an existing `scripts/full-coverage-report.json` without re-running the simulation. Useful for reviewing results after the fact.

**Usage:**
```bash
# After a --test-full-coverage run:
node --env-file=.env.simulation.local scripts/simulate-reflection.js --assert-week 2
```

**Output:**
```
════════════════════════════════════════════════════
📋  WEEK 2 ASSERTIONS  (days 8–14)
════════════════════════════════════════════════════
✅ PASS  Week 2 (days 8–14): ≥1 pattern with occurrence_count >= 2
       ↳ 2 repeating patterns
       ↳ first passed: day 12
✅ PASS  Week 2 (days 8–14): short_term_state is populated
       ↳ first passed: day 10
❌ FAIL  Day 14: goals with whys present, strengths and growth_areas populated

Week 2: 2/3 assertions passed
════════════════════════════════════════════════════
```

`N` must be 1, 2, or 3. The report file must already exist (run `--test-full-coverage` first).

---

### Available personas

| Key | Name | Description | Why Pool | shameLevelOnMiss |
|-----|------|-------------|----------|-----------------|
| `ambitious_but_inconsistent` | Alex | Building SaaS, ~60% follow-through | ✅ shallow / deeper / additive | 5 (mid-range) |
| `consistent_grinder` | Jordan | Consistent but surface-level, ~85% follow-through | ✅ shallow / deeper / additive | 2 (casual) |
| `creative_with_perfectionism` | Sam | Deep reflector but struggles to commit, ~50% follow-through | ✅ shallow / deeper / additive | 8 (high shame) |
| `burnt_out_professional` | Maya | Corporate PM building a side project, ~55% follow-through | ✅ shallow / deeper / additive | 7 (significant shame) |
| `comeback_kid` | Darius | Recovering from burnout, cautious optimist, ~70% follow-through | ✅ shallow / deeper / additive | 4 (honest, not spiraling) |

The three primary personas (`ambitious_but_inconsistent`, `consistent_grinder`, `creative_with_perfectionism`) have `whyPool` defined with tiered responses. The why tier is selected based on the day number:
- Days 1–7: `shallow` (surface-level answers)
- Days 8–20: `deeper` (emotionally honest, realizing the real reason)
- Days 21+: `additive` (60% chance) or `deeper` (40% chance)

All five personas now have `whyPool` (tiered), `shameLevelOnMiss` (0–10), and `openToDepthByDay(dayNumber)` defined.

### `whyPool` and `shameLevelOnMiss` persona fields

Each persona definition includes:

**`whyPool`** — tiered object with three arrays (`shallow`, `deeper`, `additive`) used by `generateUserResponse` when the coach asks about motivation. Tier selection is based on `dayNumber`:
- `shallow`: days 1–7 — surface-level, protective answers
- `deeper`: days 8–20 — emotionally honest, the real reason
- `additive`: days 21+ — a second, distinct dimension (60% of the time)

**`shameLevelOnMiss`** (0–10) — controls how the persona responds during `commitment_checkin` when they missed:
- 0–3: very casual, not a big deal
- 4–6: a little embarrassed, brief honest reason
- 7–10: defensive or avoidant, lots of justification

**`openToDepthByDay(dayNumber)`** — function that returns a probability (0–1) that the persona will engage deeply with a reflective question. Increases as the simulation progresses to model real coaching impact.

---

## `commitment_checkin` Stage

After the `wins` stage, if a yesterday commitment exists in session state, the coach routes through `commitment_checkin` before moving to `honest`. The simulator handles this as follows:

1. `sessionState.commitment_checkin_done` and `yesterday_commitment_in_state` are tracked per day
2. Both are forwarded to the API on every turn (in `session_state`)
3. `generateUserResponse` receives `followedThrough` (determined by `--scenario` and cross-session history) and produces a realistic commitment check-in response
4. After the day completes, `crossSessionState.lastFollowedThrough` is updated for the next day

### How `--scenario` affects `commitment_checkin`

| Scenario | `followedThrough` passed to user AI |
|----------|-------------------------------------|
| `kept_streak` | Always `true` |
| `miss_streak` | Always `false` |
| `mixed` | Alternates based on previous day's outcome |
| `cold_start` | `null` — no yesterday commitment, stage never fires |

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
  "meta": {
    "persona": "...", "start_date": "...", "days_simulated": 30, "user_id": "...", "run_at": "...",
    "scenario": "mixed", "dry_run": false
  },
  "summary": {
    "total_turns": 247,
    "avg_quality_score": 3.8,
    "sessions_completed": 28,
    "sessions_incomplete": 2,
    "flags_by_type": { "GENERIC": 12, "THERAPIST_LANGUAGE": 3 },
    "avg_why_deepening_quality": 3.4,
    "why_evolution_events": 4,
    "goals_with_multiple_whys": 2,
    "commitment_checkin_coverage": {
      "fired": 27,
      "resolved": 25,
      "should_have_fired": 29,
      "miss_rate": "7%"
    }
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
      "checkin_stage_fired": true,
      "checkin_stage_resolved": true,
      "stage_sequence": ["wins", "commitment_checkin", "honest", "tomorrow", "close"],
      "directives_fired": ["commitment_goal_bridge", "commitment_goal_why_depth"],
      "commitment_goal_bridge_done": true,
      "progress_feeling": true,
      "goal_why_committed": true,
      "anomalies": [],
      "goals_why_snapshot": [...],
      "conversation": [...]
    }
  ],
  "flagged_for_review": [...]
}
```

### New per-day session fields

| Field | Description |
|-------|-------------|
| `checkin_stage_fired` | `true` if `commitment_checkin` appeared in the stage sequence for this day |
| `checkin_stage_resolved` | `true` if `commitment_checkin_done` became `true` by end of session |
| `stage_sequence` | Array of stages visited in order, e.g. `["wins", "commitment_checkin", "honest", "tomorrow", "close"]` |
| `directives_fired` | Array of directive IDs that fired this session (read from `directive_queue` and `directive_completed` responses) |
| `commitment_goal_bridge_done` | `true` if `commitment_goal_bridge_done: true` appeared in the session response — means both bridge questions completed |
| `progress_feeling` | `true` if `progress_feeling` was extracted from the user's response at any turn this session |
| `goal_why_committed` | `true` if `goal_commitment_why: true` was set on any extracted_data response, meaning a `commitment_planning` source why was captured |
| `anomalies` | Array of strings describing unexpected stage skips, e.g. `"commitment_checkin skipped despite yesterday commitment existing"` |

### `commitment_checkin_coverage` summary stat

| Field | Description |
|-------|-------------|
| `fired` | Number of days where `commitment_checkin` stage appeared |
| `resolved` | Number of days where `commitment_checkin_done` became `true` |
| `should_have_fired` | Number of days where a yesterday commitment existed (so the stage should have fired) |
| `miss_rate` | `(should_have_fired - fired) / should_have_fired` as a percentage |

### Enhanced `scoreCoachMessage` output fields

Each message-level quality object in `conversation[].quality` now includes:

| Field | Type | Description |
|-------|------|-------------|
| `score` | 1–5 | Overall quality score |
| `flags` | string[] | Quality flags (GENERIC, THERAPIST_LANGUAGE, etc.) |
| `reason` | string | One-sentence explanation |
| `why_deepening_quality` | 1–5 or null | Only scored when coach asked about motivation/why |
| `stage_appropriate` | boolean | Was this message appropriate for the current stage? |
| `used_their_words` | boolean | Did the coach reference something specific the user said? |
| `asked_one_question` | boolean | Did the coach ask exactly one question (not zero, not two+)? |
| `advanced_correctly` | boolean or null | If a stage advance fired, was the transition appropriate? `null` if no advance. |

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
    "day3_commitment_planning_why_written": true,
    "day5_additive_why_detected": false,
    "day5_why_summary_populated": true,
    "day5_commitment_planning_whys_max_one": true,
    "day7_specific_why_referenced": true,
    "day7_commitment_planning_whys_max_one": true
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

## SQL Setup

### Initial setup (if not already done)

Run the SQL in the Supabase SQL editor as described in [Setup](#setup) above.

### `migrate-commitment-checkin.sql` — run this for `commitment_checkin` support

This migration adds the `commitment_checkin_done` column and a performance index:

```bash
# Copy the contents of scripts/migrate-commitment-checkin.sql and run it in the Supabase SQL editor
```

```sql
-- Add commitment_checkin_done to reflection_sessions
ALTER TABLE reflection_sessions
  ADD COLUMN IF NOT EXISTS commitment_checkin_done boolean DEFAULT false;

-- Index for efficient yesterday-commitment lookup
CREATE INDEX IF NOT EXISTS reflection_sessions_user_date
  ON reflection_sessions(user_id, date DESC);
```

This is safe to run multiple times.

### `goals.why_summary` column — required for bridge why synthesis

The `commitment_goal_bridge` and `commitment_goal_why_depth` directives synthesize a `why_summary` from the goal's `whys[]` array. This requires a `why_summary` column on the `goals` table:

```sql
-- Add why_summary to goals (if not already present)
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS why_summary text DEFAULT null;
```

This is safe to run multiple times. Seeded personas now include `why_summary: null` in their goal objects, so the column will be populated by `synthesizeGoalWhySummary` when the bridge completes.

---

## Cost Estimate

| Run | GPT-4o turns (coach) | GPT-4o-mini turns | Est. cost |
|-----|---------------------|-------------------|-----------|
| 30 days | ~270 | ~540 | ~$2–4 |
| 90 days | ~810 | ~1,620 | ~$6–12 |
| `--dry-run` | ~9 | ~18 | ~$0.15 |
| `--test-why-building` | ~63 | ~126 | ~$0.50–1 |
| `--test-goal-suggestion` | ~9 | ~18 | ~$0.15 |
| `--test-full-coverage` | ~189 | ~756 | ~$2–4 |

> **Note:** `--test-full-coverage` includes extra API calls (embedding, classify-intent, extract-goal-commitments, goal-commitment-stats, evaluate-goal-commitments) after each session, which adds to the GPT-4o-mini count and cost.

> **Tip:** Use `--dry-run` for a fast sanity check before a full run.
