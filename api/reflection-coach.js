/**
 * api/reflection-coach.js
 *
 * PRIMARY reflection coaching endpoint.
 *
 * Pipeline per request:
 *   1. Receive body (user_id, session_id, session_state, history, user_message, context)
 *   2. Classify intent internally
 *   3. Load context in parallel: follow_up_queue, growth_markers,
 *      last-7-session summaries, yesterday commitment, user profile, active goals
 *   4. Decide if a queued follow-up should surface before the main response
 *   5. Build the GPT-4o prompt with all context + coaching instructions
 *   6. Call GPT-4o and parse the structured response
 *   7. Post-response DB writes — all fail silently
 *   8. Return full response shape to client
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { classifyIntent, DEFAULT_CLASSIFICATION } from '../src/lib/classifier.js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';
import { practices } from '../src/lib/practiceLibrary.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * SUPABASE MIGRATION — run once in SQL editor before deploying:
 *
 * CREATE EXTENSION IF NOT EXISTS vector;
 *
 * ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS summary text;
 * ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS embedding vector(1536);
 * ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS commitment_checkin_done boolean DEFAULT false;
 * ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS checkin_outcome text CHECK (checkin_outcome IN ('kept', 'missed', 'partial'));
 * ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS checkin_opener text;
 * ALTER TABLE follow_up_queue ADD COLUMN IF NOT EXISTS type text;
 *
 * -- Goal-linked commitment tracking
 * CREATE TABLE IF NOT EXISTS goal_commitment_log (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   session_id uuid REFERENCES reflection_sessions(id) ON DELETE SET NULL,
 *   goal_id uuid REFERENCES goals(id) ON DELETE CASCADE,  -- null = no goal linked
 *   commitment_text text NOT NULL,
 *   date date NOT NULL,
 *   kept boolean,           -- null = pending, true = kept, false = missed
 *   evaluated_at timestamptz,
 *   created_at timestamptz DEFAULT now()
 * );
 * CREATE INDEX IF NOT EXISTS goal_commitment_log_user_goal ON goal_commitment_log(user_id, goal_id, date DESC);
 * CREATE INDEX IF NOT EXISTS goal_commitment_log_user_date ON goal_commitment_log(user_id, date DESC);
 *
 * -- Drop next_checkin_at from goals (replaced by behavioral motivation scoring)
 * ALTER TABLE goals DROP COLUMN IF EXISTS next_checkin_at;
 *
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS values text[];
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS short_term_state text;
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS long_term_patterns text[];
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS growth_areas text[];
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS strengths text[];
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
 * ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS consecutive_excuse_sessions int DEFAULT 0;
 *
 * CREATE OR REPLACE FUNCTION match_reflection_sessions(
 *   query_embedding vector(1536),
 *   match_user_id uuid,
 *   match_count int DEFAULT 3
 * )
 * RETURNS TABLE (id uuid, date date, summary text, similarity float)
 * LANGUAGE sql STABLE AS $$
 *   SELECT id, date, summary,
 *     1 - (embedding <=> query_embedding) AS similarity
 *   FROM reflection_sessions
 *   WHERE user_id = match_user_id
 *     AND embedding IS NOT NULL
 *     AND summary IS NOT NULL
 *   ORDER BY embedding <=> query_embedding
 *   LIMIT match_count;
 * $$;
 *
 * -- Commitment-goal bridge tracking
 * ALTER TABLE reflection_sessions ADD COLUMN IF NOT EXISTS commitment_goal_bridge_done boolean DEFAULT false;
 *
 * -- Why summary for goal motivation synthesis
 * ALTER TABLE goals ADD COLUMN IF NOT EXISTS why_summary text;
 *
 * -- Atomic JSONB array append with deduplication (run once in SQL editor):
 * -- CREATE OR REPLACE FUNCTION append_jsonb_array_item(
 * --   p_table text,
 * --   p_column text,
 * --   p_id uuid,
 * --   p_item jsonb,
 * --   p_dedup_key text DEFAULT NULL
 * -- )
 * -- RETURNS void
 * -- LANGUAGE plpgsql
 * -- AS $$
 * -- BEGIN
 * --   EXECUTE format(
 * --     'UPDATE %I SET %I = CASE
 * --        WHEN %2$I IS NULL THEN jsonb_build_array($1)
 * --        WHEN $2 IS NOT NULL AND EXISTS (
 * --          SELECT 1 FROM jsonb_array_elements(%2$I) el WHERE el->>$2 = $1->>$2
 * --        ) THEN %2$I
 * --        ELSE %2$I || jsonb_build_array($1)
 * --      END,
 * --      updated_at = now()
 * --      WHERE id = $3',
 * --     p_table, p_column
 * --   ) USING p_item, p_dedup_key, p_id;
 * -- END;
 * -- $$;
 */

const DEFAULT_CHECKLIST = { wins: false, honest: false, plan: false };
const MIN_DEEP_SESSION_MESSAGE_COUNT = 6;
const MAX_DEPTH_INSIGHTS_RETAINED = 4;
const MAX_COMMITMENT_WHYS = 1;   // max 1 active commitment_planning why per goal (always replace)
const MAX_SESSION_WHYS = 3;      // max 3 reflection_session whys kept (oldest pruned)
const MAX_WHYS_TOTAL = 5;        // absolute cap on whys[] length
const MIN_INSIGHT_KEYWORD_OVERLAP = 2;
const MIN_INSIGHT_OVERLAP_SCORE = 0.2;
const MAX_DEPTH_PROBES_PER_SESSION = 2;
const MIN_DEPTH_PROBE_MESSAGE_SPACING = 3;
const MAX_WHY_PROBES_PER_STAGE = 3;   // max why-probe questions per stage per session
const MAX_WHY_PROBE_WHYS = 2;          // max whys with source:'why_probe' retained per goal
const INSIGHT_MATCH_STOP_WORDS = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'your', 'about', 'have', 'just', 'what', 'when', 'were', 'been', 'into', 'then', 'they', 'them', 'their', 'you', 'are']);
const EXERCISE_IDS = practices.map((practice) => practice.id);
const EXERCISE_ENUM = ['none', ...EXERCISE_IDS].join('|');

// ── Motivation signal thresholds ──────────────────────────────────────────────
const MOTIVATION_STRONG_THRESHOLD = 0.7;   // ≥70% follow-through → strong
const MOTIVATION_MEDIUM_THRESHOLD = 0.4;   // ≥40% follow-through → medium; <40% → low
const MIN_EVALUABLE_COMMITMENTS = 3;       // minimum logged entries before signal is meaningful
const MIN_EVALUABLE_LAST7_COMMITMENTS = 3; // minimum last-7 fragments before rate_last_7 is considered stable
const MIN_SAMPLES_FOR_LOW_SIGNAL = 5;      // need ≥5 samples to classify as "low" vs "unknown"
const TRAJECTORY_DELTA_THRESHOLD = 0.1;   // >10% rate change between halves = improving/declining
const DAYS_SILENT_FOR_STRUGGLING = 7;      // goal not mentioned in 7+ days + declining = struggling

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Retaliate AI nightly reflection coach.

PERSONALITY:
- Smart, honest friend who has read every self-development book but doesn't sound like it
- Warm but direct. You notice things and say them. Not preachy, not generic
- Casual language. Short sentences. Real talk
- 2-3 sentences max per message. Never dump
- Celebrate wins with genuine energy, not corporate cheerleading
- Do NOT let people off the hook — ask the follow-up question that actually matters

CORE RULES:
- NEVER validate excuses. Acknowledge frustration, pivot to what's in their control
- NEVER be a therapist. Be a coach. Forward-focused, action-oriented
- NEVER be generic — use their actual words, goals, and why
- NEVER catastrophize or pile on when struggling
- ALWAYS connect observations back to their identity and future self
- IF a follow-up from the queue is due, surface it BEFORE anything else
- IF a growth marker check-in is due, weave it in naturally

TRANSPARENT COACHING — WHEN AND HOW TO SHOW YOUR INTENT:
When you ask a deeper question, pivot the conversation, or surface something meaningful, you can briefly signal *why* — in one short phrase before or woven into the question.
- This is NOT explaining yourself defensively. It's showing the user the value in what you're doing.
- Use it when: going deeper on a topic, naming a pattern, asking about their why, probing for honesty, surfacing a past insight, transitioning stages.
- Do NOT use it when: asking a generic "what went well today" type question, or in simple back-and-forth follow-ups.
- Keep the framing to one short sentence — max. Then ask the question.
- Examples of natural framing phrases (use your own words, don't use these verbatim):
  "I want to sit with that for a sec — [question]"
  "This is usually where the real stuff is — [question]"
  "I'm asking because the gap between what you wanted and what happened is worth understanding — [question]"
  "Connecting this to your why for a second — [question]"
  "I've noticed something — [question]"
  "I want to understand the mechanism here — [question]"
  "Before we move on, [question]"
  "This keeps coming up — [question]"
- Tone: casual, curious, warm. NOT clinical, NOT preachy, NOT therapy-speak.
- NEVER say "I'm asking this question because..." — show the intent, don't narrate it.

EVIDENCE FOR EXPLAINING QUESTIONS:
When you signal intent before a question (per TRANSPARENT COACHING above), draw from specific data already in your context — never signal generically.

Available evidence fields you MUST reference when they exist:
- user_insights[n].trigger: the situation/state that activates this pattern — use this to explain WHY you're going there
- user_insights[n].user_quote: their exact words from a prior session — quote it directly (e.g. "you said once: [quote]")
- user_insights[n].foothold: evidence something is already shifting — name it as proof
- user_insights[n].first_seen_date + last_seen_date: when this pattern was first observed and when it was last seen — use for "this has been happening since [month]" framing
- recent_sessions: specific dates and what happened — reference them by date, not vaguely
- goals[n].whys: what they said this goal was about before — reference the actual text
- goals[n].depth_insights: realizations they had about this goal — reference by date if available

Rules:
- When you reference a pattern or insight, include AT LEAST ONE of: a specific count, a date, or their actual words (user_quote).
- NEVER say "this keeps coming up" — say "this has come up [occurrence_count] times since [first_seen_date]"
- NEVER say "you've mentioned this before" — say "you said once: [user_quote]"
- NEVER say "I noticed something" without immediately naming the specific thing from context
- If none of the above evidence fields are populated for a topic, skip the framing entirely and just ask the question.
- The framing is one sentence. Then the question. That's it.

PROGRESS EVENTS — REAL THRESHOLD CROSSINGS:
When progress_events are present in your context, these are recorded transitions — not computed stats, but real threshold crossings that were stored when they happened.
When a progress event is relevant to what the user just said, NAME IT specifically before connecting to it.
- "Your follow-through on [goal] just crossed into strong territory — that's the first time."
- "That blocker hasn't shown up in two weeks. Something actually changed."
- "The first time you got a real insight about [goal] was [date]. What you're saying now connects to it."
Use the display_text from the event as a starting point — make it conversational, not a readout.
After referencing a progress event, set progress_event_surfaced: "<event_id>" in your response JSON so it can be marked as surfaced.

SELF-REFLECTION PRIORITY:
This is crucial. The goal is not just action — it's self-awareness. At least once per session, go deeper:
- Ask WHY, not just WHAT. "Why do you think that is?" beats "What will you do?"
- Surface the belief or pattern underneath the behavior
- Connect behavior to identity: "What does that tell you about how you see yourself?"
- Sit with the answer — don't rush to action after a deep insight
Good depth question intents (generate fresh wording from context each time):
  - Explore why the same pattern keeps repeating and what makes it sticky for them
  - Surface the internal narrative or belief framework that makes this behavior feel logical to them
  - Invite radical honesty about the underlying emotional driver, fear, or unmet need behind the behavior
  - Link the observed action/pattern to what it reveals about self-belief or identity
  - Test the hidden assumption that would need to be true for this pattern to keep happening
Never reuse the same phrasing across messages or sessions — generate each depth question fresh from the user's actual words.
Balance: go deep once, then move. Don't psychoanalyze every message.
When you go deeper, you can briefly signal the shift — "I want to sit with that" or "this is the part worth understanding" — before asking. One phrase only. This helps the user feel the question is intentional, not random.

METACOGNITIVE QUESTIONING PRINCIPLES:
- The most valuable question you can ask is one that makes the user realize something about themselves that they hadn't consciously noticed yet
- Ask questions that surface contradictions: "You said you want X, but you also said Y happened. What's going on there?"
- Ask questions about the gap between intention and action: "What was different about today vs. the days it did work?"
- Ask questions that name the pattern without naming it: "Is this the first time that's happened, or does this show up in other places too?"
- Ask questions about the decision moment: "At what point in the day did you decide not to do it?" — the answer usually reveals the real blocker
- When someone achieves something: "What made today different?" — not "great job!" — help them understand the mechanism so they can replicate it

DEPTH CONVERSATION: When the user is in a reflective back-and-forth ("what do you think" style exchange), allow the chain to continue naturally. Multiple consecutive "what do you think" exchanges are GOOD — do not prematurely pivot to action or next stage. Only close a depth thread when the user has reached an insight or naturally signals they want to move on. When the user answers a reflective/opinion question with their own reflection, the coach IS ALLOWED to follow up with another reflective question — do not count this as "drilling a topic".

ON THE CHECKLIST (wins / honest / plan):
- These are background goals — track silently from conversation
- wins: a real win or effort was mentioned. After the FIRST win is mentioned, always follow up with an open invitation to share more: e.g. "What else went well today?" or "What's another one?" — do NOT advance to the honest stage after just one win exchange. Let the user share as many wins as they want before moving on. Set wins_asked_for_more: true in the response only after you have asked this "what else?" question at least once. If the user responds with a list of wins (e.g. "sleep, app work, boxing"), you MAY ask about multiple items from that list in the same response — this is the ONE exception to the one-question rule. Only transition to honest after the user clearly signals they are done sharing wins.
- commitment_checkin: when checklist_fragments are provided, show the checklist UI by setting show_commitment_checklist: true and checklist_fragments. Do NOT ask a free-text check-in question in that case. After checklist submission, set checkin_outcome in extracted_data: "kept" if all were done, "missed" if none, "partial" otherwise. Set commitment_checkin_done: true once answered. ROUTING: after check-in is done, if commitment_score >= 50 route to wins next; if commitment_score < 50 or unknown route to honest next (set stage_advance/new_stage accordingly).
- honest: they named something they struggled with, avoided, or were dishonest with themselves about TODAY. Self-awareness about the past only — NOT plans, improvements, or future actions. Future-oriented language belongs in tomorrow stage. Do NOT set honest: true if the user is describing what they will do tomorrow or how they will improve. When a miss or honest moment is named, do NOT immediately close the honest stage or set honest_depth: true. Ask the one question that goes underneath it — not "what would you do differently" (that belongs in tomorrow) but something like "what was actually going on for you underneath that?" or "what do you think was really happening?" One question at a time — evaluate the answer before deciding whether to go deeper or close. Evaluate qualitatively: has the user answered what was actually happening underneath the surface behavior? A surface miss ("I didn't get to it", "I got distracted", "I forgot") is NOT enough. You need a genuine answer to the underneath layer — the real reason, the emotional truth, the internal conflict. Once you have a real answer to that underneath question, THEN you may set honest_depth: true. Do NOT count exchanges or use a fixed sequence — evaluate the quality of what they've said. If the answer is still surface-level, ask the one next question that goes deeper.
- plan: a concrete tomorrow commitment was stated
- After ~8 messages, if items are still empty, weave them in naturally
- Never say "you haven't completed X" — natural human transitions only
- If honest is missing after wins are covered, gently probe with self-awareness questions like: "Where did you feel like you weren't fully showing up today?" or "Is there a moment from today that's still sitting with you?" or "What part of today are you least proud of — not what you'd fix, just what happened?" The goal of the honest stage is self-awareness and honest naming of who they were TODAY — NOT planning or action. Do NOT ask "what would you do differently" or any future-action questions during the honest stage — those belong in the tomorrow stage.

ON KNOWING WHEN TO CLOSE:
- When tomorrow_commitment is filled AND the commitment-goal bridge is complete or the session has enough messages → wrap
- Do NOT keep drilling a topic that's already been answered
- If they've stated a clear plan and responded positively, that thread is CLOSED
- A good close ties together what they committed to and why it matters — in their own words — then sets is_session_complete: true
- Set is_session_complete: true when wins + plan are covered and the bridge directives are complete (or message threshold is met)
- If the user has clearly answered a question, even informally ("I'll just know", "I'm not worried about it", "I'll figure it out"), that topic is CLOSED. Do not follow up on it.
- A closed topic means: move forward or wrap up. Never re-ask what was just answered.

ON VENTING:
- One message of full acknowledgment
- Then: "Okay — and what part of that is yours to work with?"
- Empowering, not harsh. You believe in their agency.

ON EXERCISES:
- EVERY TIME you run an exercise — first time or repeat — you MUST open with a smart, specific 2-3 sentence setup before the question. Never skip this. Never go straight to the question.
- The setup must cover three things, woven naturally into 2-3 sentences:
  1. WHAT YOU NOTICED: the specific thing from this conversation, their patterns, or their history that made you choose this exercise right now. Be concrete — reference their actual words, a goal, a pattern, or something from recent sessions. NEVER say "I think this would be helpful" generically.
  2. WHAT THEY'LL GET: the specific type of insight or shift this exercise tends to surface. Not the exercise name — the actual value. E.g. "this usually surfaces the real blocker underneath", "this tends to reconnect people to why they started", "this makes the pattern visible so you can actually work with it".
  3. HOW TO ENGAGE: one brief framing of the angle or mindset to bring. E.g. "don't filter", "be honest even if it's uncomfortable", "go with the first thing that comes up".
- Keep it casual, warm, and sharp. 2-3 sentences max. Then ask the question.
- NEVER name the exercise out loud (no "I want to try a gratitude anchor"). Show the intent, don't label it.
- Draw on: user_insights[n].trigger, user_insights[n].user_quote, goals[n].whys, recent_sessions, session wins/misses already captured this session — whatever is most relevant to WHY this exercise is the right one right now.
- After exercise: connect result back to identity, goals, or future self
- implementation_intention: STOP once a specific plan is stated — one follow-up max

ANTI-EXCUSE SYSTEM (when accountability_signal === "excuse"):
Step 1 (consecutive_excuses === 1): Acknowledge without validating + pivot to control
Step 2 (consecutive_excuses >= 2): "I notice we keep landing on what you couldn't do. What could you have done differently, even with that being true?"
Step 3 (consecutive_excuses >= 3): Pull future_self. "The version of you that [future_self] doesn't live there. What would they say right now?"
Never punitive. Always warm but direct.

EXERCISE WORKFLOWS:
// Active exercise instruction injected below when selected

GOAL CONNECTION — WHEN AND HOW TO BUILD MEANING

You have a goals array. Each goal may have: id, area, title, whys (array of {text, added_at, source, motivation_signal}), vision_snapshot, depth_insights (array of {date, insight}), days_since_mentioned, suggested_next_action, motivation_signal ("strong"|"medium"|"low"|"struggling"|"unknown").
- baseline_snapshot + baseline_date: where the user was when they created this goal — use for 'you've come a long way from when you [baseline_snapshot]' framing when motivation_signal is strong or improving

GOAL WHYS (whys array):
- Each goal has a list of whys — reasons the user has articulated at different points in time
- All whys are provided as context so you know what motivations have been named before
- When you surface a goal and get a meaningful why response, you MUST decide:
  a. REPLACE: If the new why is a deeper/stronger/more specific version of an existing why → replace that one (set goal_why_replace_index to its 0-based index)
  b. ADD: If the new why is genuinely different from all existing ones — a distinct new motivating reason → add it
  c. SKIP: If the user didn't articulate anything meaningful → skip (leave goal_why_action null)
- Set extracted_data.goal_why_action: "replace" | "add" | null
- Set extracted_data.goal_why_replace_index: (number, 0-based index in whys array) only if action="replace"
- Set extracted_data.goal_why_insight: the captured why text (their actual words)
- Set extracted_data.goal_id_referenced: the goal's id
- **CRITICAL: When you capture a why (set goal_why_insight), you MUST also set goal_id_referenced to the exact 'id' field of the matching goal from the goals array. The why is silently discarded if goal_id_referenced is missing or null. This is not optional.**

WHY-BUILDING TRIGGER (when to ask about why):
- You decide when the moment is right — there is NO fixed schedule
- Good moments: user references a goal with high energy, user is struggling with a goal and you want to reconnect them, motivation_signal is "low" or "struggling" (meaning their commitment follow-through for this goal is declining), after a miss connected to a goal, user accepts a suggested goal
- during wins, if the user's win directly connects to a tracked goal — ask if the original why still holds or has grown
- motivation_signal is derived from behavioral data — commitment follow-through rate for this goal over the last 14 days. "struggling" = declining trajectory + goal hasn't been mentioned in 7+ days. "low" = below 40% follow-through. "medium" = 40-69%. "strong" = 70%+. "unknown" = not enough data yet.
- motivation_signal is "low" or "struggling", OR the user's fragmented commitments for this goal have been missed more than 60% of the time in the last 7 days specifically — this short-term miss spike is a strong signal to reconnect them to their why before the pattern deepens.
- When motivation_signal is "low" or "struggling" AND the goal comes up naturally, PRIORITIZE why-building or why_reconnect for that goal
- You can run why-building for any goal any number of times across sessions — revisiting whys is valuable, not redundant
- Bad moments: user is already doing deep honest work on something else, session is about to close, user signals they want to move on, this goal's most recent why was captured within the last 2 days (check the whys array — most recent added_at) — skip unless the user brings it up themselves
- NEVER ask "why does this goal matter to you?" verbatim — use their context
- If they have existing whys, reference them: "You said once this was about [why]. Is that still the thing that makes it real for you — or has something shifted?"
- If they have NO whys yet: "What's the thing that makes [goal title] actually matter — not the goal itself, but what's underneath it?"

You also may have quiet_goals — goals that haven't come up in 14+ days. These are a soft permission: if a natural opening exists, one gentle check-in is fine. If there's no opening, skip entirely.

GOALS NEEDING WHY-BUILDING (goals_need_why_building):
- These goals need their "why" captured or deepened — this is the ONLY reason they appear here
- has_whys: false means this goal has never had a why articulated — this is the highest priority: get their first why before anything else
- has_whys: true means a previous why exists but it's time to revisit and deepen it — reference their existing whys and explore whether it's still true or has shifted
- If one of these goals comes up organically in the honest or tomorrow stage, ask the one why question — don't wait for a perfect opening, create one when the goal is already in the conversation
- If the goal has NOT come up at all in the current session, do not force it
- This is NOT a generic "check in on goal progress" — it is specifically about understanding motivation depth

CORE RULE: You are NOT managing the user through a goals framework. Goals are background knowledge. Use them when the moment is right — not because they're there.

HARD LIMITS:
- Never surface a goal that naturally came up in wins already — you've got it, let it breathe

WHEN TO MAKE THE CONNECTION:

1. User mentions something that connects to a goal and reports it like a fact
   → They're reporting, not realizing the significance
   → Don't just celebrate — help them feel what it means
   → Use the richest context available: if whys has entries use the most resonant one. If vision_snapshot exists use it.
   → "That's not just [what they did]. You've been working toward [goal title]. What was that like?"
   → Set extracted_data.goal_id_referenced to the goal's id

2. User is stuck on something that connects to a goal
   → One question that goes under the surface behavior
   → Priority order of what to reference:
     a. If depth_insights exist for this goal: "You realized once [most recent insight]. How does that connect to what's making it hard now?"
     b. If whys has entries: "You said this is really about [most recent why text]. What happens to that when you avoid it?"
     c. If whys is empty: "You set this goal. What's the real thing that makes it hard to show up for?"
     d. If depth_insights is empty AND the user is stuck on this goal during the honest stage: this is the first opportunity to capture a real realization about this goal — don't let the honest stage end without it. Ask the question that goes all the way under: "What's actually getting in the way when it comes to [goal title]?" When they answer, set extracted_data.goal_depth_insight to their words.
   → Set extracted_data.goal_id_referenced to the goal's id

USER INSIGHTS IN HONEST STAGE:
When a miss or stuck moment is mentioned during the honest stage, scan the available user_insights (in context as user_insights array) for any insight whose trigger field matches what's happening right now. If found:
- Surface it using the user_quote (their own words, not the AI's label for the pattern)
- Reference the narrative if it adds useful context
- If a foothold is defined, consider using it as a gentle bridge toward what's next
- Do NOT announce it as a "pattern" or "insight" — weave it naturally: "You've mentioned something like this before — [user_quote]. What's showing up for you right now that's similar?"
- This is the same treatment goals already get with depth_insights — just applied to cross-session synthesized patterns

3. User questions a goal's relevance
   → "I'm not sure I want this anymore" / "Maybe I was being unrealistic"
   → Do NOT push them back toward the goal. Do NOT reassure them it's worth it.
   → ONE question only: "What changed?"
   → Sit with their answer. Follow their lead.
   → If they reconnect: then bridge to vision
   → If they release: acknowledge and ask "What matters more to you right now?"
   → If releasing: set extracted_data.goal_suggestion: { "action": "pause", "goal_id": "...", "reason": "their exact words" }

4. User says something vivid about what their life looks like when a goal is done
   → Capture it: set extracted_data.goal_vision_fragment with their exact words
   → Set extracted_data.goal_id_referenced to the matching goal
   → Then the identity close: "That's who you're becoming. And tonight you [specific thing they did]. That's the person who gets there."

5. User has a realization about a goal
   → Set extracted_data.goal_depth_insight with the realization in their words
   → Set extracted_data.goal_id_referenced

6. Suggesting a new goal (when user mentions they want to pursue something new):
   → Only suggest if the user explicitly indicates they want to track it as a goal
   → Set extracted_data.goal_suggestion: { "action": "new_goal", "title": "concise goal title", "category": "health|career|relationships|finances|learning|creativity|mindset|other" }
   → DO NOT set goal_id (this is a brand-new goal, not an existing one)
   → After suggesting, tell the user you'll add it — they'll confirm in the UI
   → Only one new goal suggestion per session

7. User expresses how they feel about their progress toward a goal
   → Set extracted_data.progress_feeling with their exact words about momentum or stagnation
   → Set extracted_data.goal_id_referenced to the matching goal
   → Use this when they say things like "I feel like I'm finally getting somewhere with this" or "I don't think I'm making any progress"

WHAT NOT TO DO:
- Never announce you're doing a "goal check-in"
- Never redirect a conversation that's already going somewhere real just to fit in a goal
- Never manufacture a moment that isn't there

FUTURE SELF BRIDGE FREQUENCY:
- Connect current daily actions to the user's future self vision roughly once per week (not every session)
- Track this via the exercises_run array: if 'future_self_bridge' has been run in the last 5 sessions' recent data, skip it
- When you do surface it, make it feel earned, not scripted

GOAL WHY-PROBE QUESTIONS (wins and honest stages):
When you run a why-probe question, you are NOT asking whether the user's why has changed. You are asking a question that makes them feel the connection between today's action and their long-term goals. Three angles exist — use each at most once per session across all why-probe questions:

ANGLE 1 — Action → Goal progress:
"You [did/didn't do X today]. In the context of [goal title] — does that actually feel like forward movement, or just activity?" (for a win)
"You said you didn't get to [X]. What did that actually cost you in terms of [goal] — not logistically, but in terms of where you're trying to get?" (for a miss)
Best when: goal exists, no vision or why needed.

ANGLE 2 — Action → Long-term self:
If vision_snapshot exists: "You [did X]. You've talked about wanting to [vision_snapshot]. Does today feel like a step in that direction, or does it feel separate from that?"
If why exists: "You've said [goal] matters because [their why]. When you [did/didn't do X] today — did it connect to that at all, or did it feel like it was for a completely different reason?"
Best when: vision_snapshot or a specific why is available.

ANGLE 3 — How they actually feel:
"Not about whether it was good or bad — when you [did/skipped X today], what was the feeling underneath it? What was actually going on for you?"
Best when: the action feels emotionally loaded from the conversation, or no goal context is available.

SELECTION RULES:
- Pick the angle that fits the richest available data: vision_snapshot → prefer Angle 2 (vision); named why → prefer Angle 2 (why) or Angle 1; no why or vision → Angle 1 or Angle 3
- Across all why-probe questions in a session, use each angle at most once
- After asking, evaluate the response. If it reveals something meaningful about motivation → set goal_why_probe_insight with {goal_id, text, action ("replace"|"add"|null), replace_index}. If nothing meaningful → set goal_why_probe_insight: null
- Do NOT telegraph the extraction — never say "I'm asking because I want to understand your motivation." Just ask the question.

RETURN JSON EXACTLY (no markdown, no extra keys):
{
  "assistant_message": "your message (2-3 sentences, one question)",
  "chips": [{"label": "string", "value": "string"}] | null,
  "stage_advance": false,
  "new_stage": "wins|commitment_checkin|honest|tomorrow|complete" | null,
  "extracted_data": {
    "checkin_outcome": null,
    "mood": null,
    "win_text": null,
    "miss_text": null,
    "blocker_tags": [],
    "commitment_minimum": null, // string: bare minimum floor commitment for tomorrow
    "commitment_stretch": null, // string: stretch/ideal commitment for tomorrow
    "tomorrow_commitment": null,
    "commitment_score": null, // integer 0-100: scored in commitment_checkin only
    "self_hype_message": null,
    "depth_insight": null,
    "goal_id_referenced": null,  // REQUIRED when goal_why_insight is set — without this the why is silently discarded
    "goal_why_insight": null,
    "goal_why_action": null,
    "goal_why_replace_index": null,
    "goal_vision_fragment": null,
    "goal_depth_insight": null,
    "goal_suggestion": null,
    "goal_commitment_why": false,
    "progress_feeling": null,  // string: user's expressed feeling about progress toward a goal this session (their words). Set when they say something meaningful about momentum/stagnation on a goal. Null otherwise.
    "goal_why_probe_insight": null  // object {goal_id, text, action, replace_index} or null — set after a why-probe response reveals meaningful motivation. Written to goals.whys with source:'why_probe'.
  },
  "exercise_run": "${EXERCISE_ENUM}",
  "checklist_updates": {"wins": false, "honest": false, "plan": false},
  "wins_asked_for_more": false,
  "honest_depth": false,
  "commitment_checkin_done": false,
  "stage_order_swapped": false,
  "show_commitment_checklist": false, // true when presenting fragment checklist to user
  "checklist_fragments": null, // array of {id, text, type?} fragments to check off
  "follow_up_queued": false,
  "follow_up_triggered": false,
  "is_session_complete": false,
  "directive_completed": null,
  "progress_event_surfaced": null
}

Set "directive_completed" to the id of the directive you executed this message (from active_directive.id in context) when you have fully delivered the directive's intended coaching action in your response, or null if you did not act on it. Only mark one directive as completed per message.`;

// ── Per-exercise coach instructions (injected only when that exercise is selected) ──

const EXERCISE_PROMPTS = Object.fromEntries(practices.map((practice) => [practice.id, practice.coach_prompt]));
const EXERCISE_FIRST_TIME_INTROS = Object.fromEntries(
  practices.map((practice) => [practice.id, practice.first_time_intro]).filter(([, intro]) => intro)
);

/**
 * Sanitize user-provided text before interpolating into AI prompts.
 * Strips characters that could be used for prompt injection while preserving readability.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizeForPrompt(text, maxLen = 200) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control characters
    .replace(/`/g, "'")                                   // neutralize backtick template literals
    .slice(0, maxLen)
    .trim();
}

/**
 * Tokenize free text into lowercase keyword terms for lightweight overlap scoring.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenizeKeywords(text) {
  if (!text || typeof text !== 'string') return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !INSIGHT_MATCH_STOP_WORDS.has(word))
  );
}

/**
 * Finds the best unlocked-practice insight match for the current user message.
 * Match score = overlap_count / insight_keyword_count, gated by minimum overlap constants.
 * @param {object} params
 * @returns {{insightId:string, exerciseId:string, insightContext:string, score:number}|null}
 */
function findInsightTriggeredExercise({
  userMessage,
  userInsights = [],
  sessionState = {},
  suggestedExercise = 'none',
}) {
  const currentStage = sessionState.current_stage || 'wins';
  if (!userMessage || currentStage === 'commitment_checkin') return null;
  if (suggestedExercise && suggestedExercise !== 'none') return null;
  const triggeredInsights = Array.isArray(sessionState.insight_exercises_triggered)
    ? sessionState.insight_exercises_triggered
    : [];
  const messageKeywords = tokenizeKeywords(userMessage);
  if (messageKeywords.size === 0) return null;

  let bestMatch = null;

  for (const insight of userInsights) {
    if (!insight?.id || triggeredInsights.includes(insight.id)) continue;
    const practicesForInsight = Array.isArray(insight.unlocked_practices) ? insight.unlocked_practices : [];
    const availablePractice = practicesForInsight.find((id) => EXERCISE_PROMPTS[id]);
    if (!availablePractice) continue;

    const insightKeywords = tokenizeKeywords(`${insight.pattern_narrative || ''} ${insight.pattern_label || ''}`);
    if (insightKeywords.size === 0) continue;
    let overlapCount = 0;
    for (const keyword of messageKeywords) {
      if (insightKeywords.has(keyword)) overlapCount += 1;
    }
    const score = overlapCount / Math.max(insightKeywords.size, 1);
    if (overlapCount >= MIN_INSIGHT_KEYWORD_OVERLAP && score >= MIN_INSIGHT_OVERLAP_SCORE && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        insightId: insight.id,
        exerciseId: availablePractice,
        insightContext: insight.pattern_narrative || insight.pattern_label || '',
        score,
      };
    }
  }

  return bestMatch;
}

/**
 * Gate depth_probe routing with session caps and message spacing.
 * @param {object} sessionState
 * @param {number} messageCount
 * @returns {boolean}
 */
function shouldAllowDepthProbe(sessionState, messageCount) {
  const depthProbeCount = Number(sessionState?.depth_probe_count || 0);
  const lastDepthProbeMessageIndex = Number(sessionState?.last_depth_probe_message_index);
  if (depthProbeCount >= MAX_DEPTH_PROBES_PER_SESSION) return false;
  if (Number.isFinite(lastDepthProbeMessageIndex) && messageCount - lastDepthProbeMessageIndex < MIN_DEPTH_PROBE_MESSAGE_SPACING) return false;
  return true;
}

/**
 * Normalizes checklist fragment display text with minimum/stretch labels.
 * @param {{type?: string, commitment_text?: string}} fragment
 * @returns {string}
 */
function formatChecklistFragmentText(fragment) {
  if (fragment?.type === 'minimum') return `Minimum: ${fragment.commitment_text}`;
  if (fragment?.type === 'stretch') return `Stretch: ${fragment.commitment_text}`;
  return fragment?.commitment_text || '';
}

/**
 * Maps deferred directive ids to follow-up queue types.
 * @param {string} directiveId
 * @returns {'depth_followup'|'commitment_followup'|'exercise_followup'}
 */
function getFollowUpTypeForDirective(directiveId = '') {
  if (directiveId.includes('depth')) return 'depth_followup';
  if (directiveId.includes('commitment') || directiveId.includes('tomorrow')) return 'commitment_followup';
  return 'exercise_followup';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// tzOffset is the value from client's new Date().getTimezoneOffset() (minutes WEST of UTC, e.g. EST = 300)
function getTimeOfDay(tzOffset) {
  if (tzOffset != null) {
    const utcHour = new Date().getUTCHours();
    const localHour = ((utcHour * 60 - tzOffset) / 60 + 24) % 24;
    if (localHour < 12) return 'morning';
    if (localHour < 17) return 'afternoon';
    if (localHour < 21) return 'evening';
    return 'night';
  }
  // Fallback: use server local time (Vercel = UTC, but better than nothing)
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getTimeGreeting(tzOffset) {
  const map = {
    morning: 'Hey, good morning.',
    afternoon: 'Hey, good afternoon.',
    evening: 'Hey, good evening.',
    night: "Hey, it's getting late.",
  };
  return map[getTimeOfDay(tzOffset)];
}

// Returns YYYY-MM-DD based on the client-supplied date string (preferred) or server local time.
// clientDate: YYYY-MM-DD string sent from the browser (the user's actual local date)
// offsetDays: e.g. -1 for yesterday relative to clientDate
function localDate(offsetDays = 0, clientDate) {
  let d;
  if (clientDate) {
    const [y, m, day] = clientDate.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date();
  }
  if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today(clientDate) {
  return localDate(0, clientDate);
}

function daysFromNow(n, clientDate) {
  return localDate(n, clientDate);
}

// ── Stage advancement heuristic ───────────────────────────────────────────────

const LOW_CHECKIN_EMOTIONAL_STATES = new Set(['low', 'stressed', 'anxious', 'frustrated', 'stuck', 'flat', 'overwhelmed']);
const LOW_CHECKIN_SIGNAL_PATTERNS = [
  /\bstressed\b/i,
  /\banxious\b/i,
  /\bfrustrated\b/i,
  /\bstuck\b/i,
  /\boverwhelmed\b/i,
  /\bdrained\b/i,
  /\bexhausted\b/i,
  /\bburn(?:ed|t)\s*out\b/i,
  /\bheavy\b/i,
  /\brough\b/i,
  /\bhard\b/i,
  /\bnot\s+great\b/i,
  /\bnot\s+good\b/i,
  /\bflat\b/i,
  /\boff\b/i,
];

function hasLowCheckinSignal(message = '') {
  if (!message || typeof message !== 'string') return false;
  return LOW_CHECKIN_SIGNAL_PATTERNS.some((pattern) => pattern.test(message));
}

function deriveStageHint(sessionState, classifierChecklist, completedDirectives = [], messageCount = 0, intentData = null, lastUserMessage = '') {
  const stage = sessionState.current_stage || 'commitment_checkin';
  const cl = { ...(sessionState.checklist || {}), ...(classifierChecklist || {}) };
  const hasPlan = !!sessionState.tomorrow_commitment;
  const stageOrderSwapped = sessionState.stage_order_swapped === true;
  const hasYesterdayCommitment = !!(sessionState.yesterday_commitment || sessionState.yesterday_commitment_in_state);
  const completed = Array.isArray(completedDirectives)
    ? completedDirectives
    : (Array.isArray(sessionState.completed_directives) ? sessionState.completed_directives : []);

  // commitment_checkin done — route based on opener state (no yesterday) or score (yesterday exists)
  if (stage === 'commitment_checkin' && sessionState.commitment_checkin_done === true) {
    if (!hasYesterdayCommitment) {
      const emotionalState = typeof intentData?.emotional_state === 'string' ? intentData.emotional_state.toLowerCase() : '';
      const intent = typeof intentData?.intent === 'string' ? intentData.intent.toLowerCase() : '';
      const heavySignal = LOW_CHECKIN_EMOTIONAL_STATES.has(emotionalState) || intent === 'stuck' || hasLowCheckinSignal(lastUserMessage);
      if (stageOrderSwapped || heavySignal) return 'honest';
      return 'wins';
    }
    const parsedScore = Number(sessionState.commitment_score);
    const score = Number.isFinite(parsedScore) ? parsedScore : null;
    // score >= 50 (mostly kept) → wins next, celebrate first
    if (score !== null && score >= 50) return 'wins';
    // score < 50, 0, or unknown → honest first (name the miss/partial)
    return 'honest';
  }

  if (stage === 'wins' && !sessionState.commitment_checkin_done && sessionState.yesterday_commitment) {
    return 'commitment_checkin';
  }

  // wins stage done — determine what comes next
  if (stage === 'wins' && cl.wins && sessionState.wins_asked_for_more === true) {
    // if honest is already completed (wins came after honest), advance to tomorrow
    if (cl.honest || stageOrderSwapped) return 'tomorrow';
    // honest hasn't happened yet, go to honest next
    return 'honest';
  }

  // honest stage done — determine what comes next
  // Advance if honest_depth fired OR if honest checklist is done and we've had enough messages (fallback)
  const honestDepthSatisfied = sessionState.honest_depth === true || (cl.honest && messageCount >= 6);
  if (stage === 'honest' && cl.honest && honestDepthSatisfied) {
    // if wins is already completed (honest came after wins), advance to tomorrow
    if (cl.wins) return 'tomorrow';
    // wins hasn't happened yet, go to wins next
    return 'wins';
  }

  // tomorrow → complete: gate purely on real checklist signals, no message counters
  const bridgeDone = sessionState.commitment_goal_bridge_done === true;
  if (stage === 'tomorrow' && hasPlan && sessionState.commitment_minimum && bridgeDone) return 'complete';
  return null;
}

// ── Parallel context loaders (all fail silently) ──────────────────────────────

async function loadFollowUpQueue(userId, currentSignals = [], clientDate) {
  try {
    const { data } = await supabase
      .from('follow_up_queue')
      .select('id, context, question, trigger_condition, check_back_after, type')
      .eq('user_id', userId)
      .eq('triggered', false)
      .is('resolved_at', null)
      .order('check_back_after', { ascending: true });
    if (!data || data.length === 0) return [];
    const todayStr = today(clientDate);
    return data.filter((item) => {
      if (item.check_back_after <= todayStr) return true;
      if (item.trigger_condition && currentSignals.includes(item.trigger_condition)) return true;
      return false;
    }).map((item) => ({ ...item, type: item.type || 'exercise_followup' }));
  } catch (_e) { return []; }
}

async function loadCommitmentStats(userId, clientDate) {
  try {
    const todayStr = today(clientDate);

    // Fetch last 14 days of sessions for follow-through computation
    const { data: sessions14 } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete, commitment_score')
      .eq('user_id', userId)
      .gte('date', localDate(-14, clientDate))
      .lte('date', todayStr)
      .order('date', { ascending: true });

    const allSessions = sessions14 || [];
    const sessionsByDate = {};
    for (const s of allSessions) {
      sessionsByDate[s.date] = s;
    }

    const day7ago = localDate(-7, clientDate);
    const last7 = allSessions.filter((s) => s.date >= day7ago);

    // Compute follow-through for last 7 days
    const withCommitment = last7.filter((s) => !!s.tomorrow_commitment);
    if (withCommitment.length === 0) return null;

    let kept = 0;
    let total = 0;

    for (let idx = 0; idx < withCommitment.length; idx++) {
      const s = withCommitment[idx];
      const nextDay = localDate(1, s.date);
      const nextSession = sessionsByDate[nextDay];
      const isLastInWindow = idx === withCommitment.length - 1;

      if (isLastInWindow && !nextSession?.is_complete) {
        // Most recent commitment — next day not yet complete, skip (pending)
        continue;
      }

      total++;
      if (nextSession?.is_complete) kept++;
    }

    if (total < 3) return null;

    const rate7 = kept / total;

    // Also compute prior 7 for trajectory
    const day14ago = localDate(-14, clientDate);
    const prior7 = allSessions.filter((s) => s.date >= day14ago && s.date < day7ago);
    const priorWithCommitment = prior7.filter((s) => !!s.tomorrow_commitment);
    let priorKept = 0;
    let priorTotal = 0;

    for (let idx = 0; idx < priorWithCommitment.length; idx++) {
      const s = priorWithCommitment[idx];
      const nextDay = localDate(1, s.date);
      const nextSession = sessionsByDate[nextDay];
      const isLastInWindow = idx === priorWithCommitment.length - 1;

      if (isLastInWindow && !nextSession?.is_complete) {
        continue;
      }

      priorTotal++;
      if (nextSession?.is_complete) priorKept++;
    }
    const ratePrior = priorTotal > 0 ? priorKept / priorTotal : null;

    let trajectory = 'stable';
    if (ratePrior !== null) {
      if (rate7 - ratePrior > 0.1) trajectory = 'improving';
      else if (ratePrior - rate7 > 0.1) trajectory = 'declining';
    }

    const scoredLast7 = last7
      .map((s) => s.commitment_score)
      .filter((score) => Number.isFinite(score));
    const avgScore7 = scoredLast7.length > 0
      ? scoredLast7.reduce((sum, score) => sum + score, 0) / scoredLast7.length
      : null;
    const recentScores = last7
      .slice(-2)
      .map((s) => s.commitment_score)
      .filter((score) => Number.isFinite(score));

    return { rate7, trajectory, kept7: kept, total7: total, avgScore7, recentScores };
  } catch (_e) { return null; }
}

async function loadGrowthMarkers(userId, clientDate) {
  try {
    const { data } = await supabase
      .from('growth_markers')
      .select('id, theme, check_in_message, check_in_after')
      .eq('user_id', userId)
      .eq('checked_in', false)
      .lte('check_in_after', today(clientDate))
      .not('check_in_after', 'is', null);
    return data || [];
  } catch (_e) { return []; }
}

async function loadUserInsights(userId) {
  try {
    const { data } = await supabase
      .from('user_insights')
      .select('id, pattern_label, pattern_type, pattern_narrative, trigger_context, user_quote, foothold, unlocked_practices, confidence_score, strength_evidence, first_seen_date, last_seen_date')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(5);
    return data || [];
  } catch (_e) { return []; }
}

// ── Pre-session state (computed from already-loaded arrays, zero new DB queries) ──

function computePreSessionState(clientDate, { recentSessions = [], followUpQueue = [], growthMarkers = [], userInsights = [] } = {}) {
  try {
    const lastSession = recentSessions[0] || null;
    let days_since_last_session = null;
    let cold_start = false;
    if (lastSession?.date) {
      const todayStr = today(clientDate);
      const [ty, tm, td] = todayStr.split('-').map(Number);
      const [ly, lm, ld] = lastSession.date.split('-').map(Number);
      const todayMs = new Date(ty, tm - 1, td).getTime();
      const lastMs = new Date(ly, lm - 1, ld).getTime();
      days_since_last_session = Math.round((todayMs - lastMs) / (1000 * 60 * 60 * 24));
      cold_start = days_since_last_session > 7;
    } else {
      cold_start = true;
    }

    const follow_up_due = followUpQueue.length > 0
      ? { question: followUpQueue[0].question, context: followUpQueue[0].context }
      : null;

    const growth_marker_due = growthMarkers.length > 0
      ? { theme: growthMarkers[0].theme, check_in_message: growthMarkers[0].check_in_message }
      : null;

    let suggested_practice = null;
    let suggested_practice_reason = null;
    if (userInsights.length > 0) {
      const insightWithPractice = userInsights.find((ins) => Array.isArray(ins.unlocked_practices) && ins.unlocked_practices.length > 0);
      if (insightWithPractice) {
        suggested_practice = insightWithPractice.unlocked_practices[0];
        suggested_practice_reason = `user_insight: ${insightWithPractice.pattern_narrative || insightWithPractice.pattern_label || ''}`;
      }
    }

    let returning_user_context = null;
    if (lastSession) {
      const parts = [];
      if (days_since_last_session !== null) parts.push(`${days_since_last_session} day${days_since_last_session !== 1 ? 's' : ''} ago`);
      if (lastSession.summary) {
        parts.push(lastSession.summary);
      } else if (lastSession.tomorrow_commitment) {
        parts.push(`committed to "${lastSession.tomorrow_commitment}"`);
      }
      if (lastSession.mood_end_of_day) parts.push(`mood: ${lastSession.mood_end_of_day}`);
      returning_user_context = parts.join('. ');
    }

    return {
      days_since_last_session,
      cold_start,
      follow_up_due,
      growth_marker_due,
      suggested_practice,
      suggested_practice_reason,
      returning_user_context,
    };
  } catch (_e) { return {}; }
}

async function triggerInsightSynthesis(userId, authToken) {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    // Validate token format (no whitespace/newlines) before forwarding as a header value
    const safeToken = authToken && /^[^\s]+$/.test(authToken) ? authToken : null;
    fetch(`${baseUrl}/api/synthesize-insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward the caller's JWT so synthesize-insights can verify identity server-side
        ...(safeToken ? { Authorization: `Bearer ${safeToken}` } : {}),
      },
    }).catch(() => {});
  } catch (_e) {}
}

async function loadRecentSessionsSummary(userId) {
  try {
    const { data } = await supabase
      .from('reflection_sessions')
      .select('date, wins, misses, tomorrow_commitment, current_stage, checklist, mood_end_of_day, summary, blocker_tags, exercises_run')
      .eq('user_id', userId)
      .eq('is_complete', true)
      .order('date', { ascending: false })
      .limit(7);
    return data || [];
  } catch (_e) { return []; }
}

async function loadYesterdayCommitment(userId, clientToday) {
  try {
    const { data } = await supabase
      .from('reflection_sessions')
      .select('tomorrow_commitment')
      .eq('user_id', userId)
      .eq('date', localDate(-1, clientToday))
      .maybeSingle();
    return data?.tomorrow_commitment || null;
  } catch (_e) { return null; }
}

async function loadYesterdayCommitmentDetails(userId, clientToday) {
  try {
    const { data } = await supabase
      .from('reflection_sessions')
      .select('commitment_minimum, commitment_stretch, checkin_opener')
      .eq('user_id', userId)
      .eq('date', localDate(-1, clientToday))
      .maybeSingle();
    return {
      commitment_minimum: data?.commitment_minimum || null,
      commitment_stretch: data?.commitment_stretch || null,
      checkin_opener: data?.checkin_opener || null,
    };
  } catch (_e) {
    return { commitment_minimum: null, commitment_stretch: null, checkin_opener: null };
  }
}

async function loadYesterdayFragments(userId, clientToday) {
  try {
    const yesterday = localDate(-1, clientToday);
    const { data } = await supabase
      .from('goal_commitment_log')
      .select('id, commitment_text, fragment_index, commitment_type, goal_id, kept')
      .eq('user_id', userId)
      .eq('date', yesterday)
      .order('fragment_index', { ascending: true });
    return (data || []).map((fragment) => {
      const type = (fragment.commitment_type === 'minimum' || fragment.commitment_type === 'stretch')
        ? fragment.commitment_type
        : (fragment.fragment_index === 0 ? 'minimum' : (fragment.fragment_index === 1 ? 'stretch' : null));
      return { ...fragment, type };
    });
  } catch (_e) { return []; }
}

async function loadTodayEarlyCommitment(userId, clientToday) {
  try {
    const { data } = await supabase
      .from('reflection_sessions')
      .select('tomorrow_commitment, commitment_made_at')
      .eq('user_id', userId)
      .eq('date', today(clientToday))
      .maybeSingle();
    if (!data?.tomorrow_commitment || !data?.commitment_made_at) return null;
    return { commitment: data.tomorrow_commitment, made_at: data.commitment_made_at };
  } catch (_e) { return null; }
}

async function loadUserProfile(userId) {
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('full_name, display_name, bio, identity_statement, big_goal, why, future_self, life_areas, blockers, exercises_explained, values, short_term_state, long_term_patterns, growth_areas, strengths, consecutive_excuse_sessions')
      .eq('id', userId)
      .maybeSingle();
    return data || null;
  } catch (_e) { return null; }
}

async function loadActiveGoals(userId) {
  try {
    const { data } = await supabase
      .from('goals')
      .select('id, title, category, whys, why_summary, vision_snapshot, depth_insights, last_mentioned_at, suggested_next_action, baseline_snapshot, baseline_date')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(6);

    if (!data) return [];

    const today = new Date();
    return data.map((g) => ({
      ...g,
      days_since_mentioned: g.last_mentioned_at
        ? Math.floor((today - new Date(g.last_mentioned_at)) / 86400000)
        : null,
      depth_insights: Array.isArray(g.depth_insights) ? g.depth_insights : [],
    }));
  } catch (_e) { return []; }
}


// ── Goal commitment stats loader ──────────────────────────────────────────────

async function loadGoalCommitmentStats(userId, clientDate) {
  try {
    const sinceDate = localDate(-14, clientDate);
    const todayStr = today(clientDate);
    const midpoint = localDate(-7, clientDate);
    const day7ago = localDate(-7, clientDate);

    const { data: logs } = await supabase
      .from('goal_commitment_log')
      .select('goal_id, date, kept')
      .eq('user_id', userId)
      .gte('date', sinceDate)
      .lte('date', todayStr);
    // Intentionally include kept=null rows here:
    // - rate calculations below only use rowsWithKept
    // - but date recency (days_since_last_commitment) should still reflect pending fragments

    if (!logs || logs.length === 0) return [];

    // Group by goal_id
    const byGoal = {};
    for (const log of logs) {
      const gid = log.goal_id || '__unlinked__';
      if (!byGoal[gid]) byGoal[gid] = { rows: [], dates: [] };
      byGoal[gid].rows.push(log);
      byGoal[gid].dates.push(log.date);
    }

    return Object.entries(byGoal).map(([goalId, stats]) => {
      const rows = stats.rows;
      const rowsWithKept = rows.filter((r) => r.kept !== null);
      const keptLast14 = rowsWithKept.filter((r) => r.kept === true).length;
      const totalLast14 = rowsWithKept.length;

      const last7Rows = rows.filter((r) => r.date > day7ago);
      const last7WithKept = last7Rows.filter((r) => r.kept !== null);
      const last7Kept = last7WithKept.filter((r) => r.kept === true).length;
      // Keep threshold aligned with MIN_EVALUABLE_LAST7_COMMITMENTS to avoid overreacting to 1-2 fragments.
      const rate_last_7 = last7WithKept.length >= MIN_EVALUABLE_LAST7_COMMITMENTS
        ? last7Kept / last7WithKept.length
        : null;

      const recentLogs = rowsWithKept.filter((l) => l.date > midpoint);
      const priorLogs = rowsWithKept.filter((l) => l.date <= midpoint);
      const recentRate =
        recentLogs.length > 0
          ? recentLogs.filter((l) => l.kept).length / recentLogs.length
          : null;
      const priorRate =
        priorLogs.length > 0
          ? priorLogs.filter((l) => l.kept).length / priorLogs.length
          : null;

      let trajectory = 'stable';
      if (recentRate !== null && priorRate !== null) {
        if (recentRate - priorRate > TRAJECTORY_DELTA_THRESHOLD) trajectory = 'improving';
        else if (priorRate - recentRate > TRAJECTORY_DELTA_THRESHOLD) trajectory = 'declining';
      }

      const sortedDates = [...stats.dates].sort();
      const lastDate = sortedDates[sortedDates.length - 1];
      const days_since_last_commitment = lastDate
        ? Math.floor((new Date(todayStr) - new Date(lastDate)) / 86400000)
        : null;

      return {
        goal_id: goalId === '__unlinked__' ? null : goalId,
        rate_last_14: totalLast14 >= MIN_EVALUABLE_COMMITMENTS ? keptLast14 / totalLast14 : null,
        rate_last_7,
        trajectory,
        kept_last_14: keptLast14,
        total_last_14: totalLast14,
        days_since_last_commitment,
      };
    });
  } catch (_e) { return []; }
}

// ── Compute goal motivation signal (pure, no DB) ──────────────────────────────

function computeGoalMotivationSignal(goalStats, goal) {
  // goalStats: { rate_last_14, trajectory, total_last_14, days_since_last_commitment }
  // goal: { days_since_mentioned }
  if (!goalStats || goalStats.total_last_14 < MIN_EVALUABLE_COMMITMENTS) return 'unknown';
  const { rate_last_14, rate_last_7, trajectory } = goalStats;
  const daysSilent = goal.days_since_mentioned ?? 999;
  // If 7-day rate is very low even if 14-day is ok, signal struggling sooner
  if (goalStats.rate_last_7 != null && goalStats.rate_last_7 < 0.4 && goalStats.total_last_14 >= 3) {
    return 'struggling';
  }
  // Weight short-term behavior more heavily so recent slippage/improvement shows up faster.
  const effectiveRate = rate_last_7 !== null ? (rate_last_14 * 0.4 + rate_last_7 * 0.6) : rate_last_14;

  if (effectiveRate >= MOTIVATION_STRONG_THRESHOLD && trajectory !== 'declining') return 'strong';
  if (effectiveRate >= MOTIVATION_MEDIUM_THRESHOLD && trajectory !== 'declining') return 'medium';
  if (trajectory === 'declining' || (effectiveRate < MOTIVATION_MEDIUM_THRESHOLD && goalStats.total_last_14 >= MIN_SAMPLES_FOR_LOW_SIGNAL)) {
    if (daysSilent >= DAYS_SILENT_FOR_STRUGGLING) return 'struggling';
    return 'low';
  }
  return 'medium';
}

// ── Goal commitment evaluation (fire-and-forget at session start) ─────────────

async function runGoalCommitmentEvaluation(userId, clientDate) {
  // Runs inline — no HTTP round-trip. Fire-and-forget: never awaited.
  try {
    const twoDaysAgo = localDate(-2, clientDate);
    const now = new Date().toISOString();

    // Mark commitments from 2+ days ago that are still null as missed
    await supabase
      .from('goal_commitment_log')
      .update({ kept: false, evaluated_at: now })
      .eq('user_id', userId)
      .lt('date', twoDaysAgo)
      .is('kept', null);
  } catch (_e) {
    // fire-and-forget — evaluation failure must never block the session
  }
}

// ── Post-response DB writes (all fail silently) ───────────────────────────────

async function updateSessionChecklist(sessionId, checklistUpdates) {
  try {
    const { data: current } = await supabase
      .from('reflection_sessions').select('checklist').eq('id', sessionId).maybeSingle();
    const merged = { ...(current?.checklist || { ...DEFAULT_CHECKLIST }), ...checklistUpdates };
    await supabase.from('reflection_sessions')
      .update({ checklist: merged, updated_at: new Date().toISOString() }).eq('id', sessionId);
  } catch (_e) {}
}

async function updateSessionExercise(sessionId, exerciseName, consecutiveExcuses) {
  try {
    const { data: current } = await supabase
      .from('reflection_sessions').select('exercises_run').eq('id', sessionId).maybeSingle();
    const exercisesRun = Array.isArray(current?.exercises_run) ? current.exercises_run : [];
    if (exerciseName && exerciseName !== 'none' && !exercisesRun.includes(exerciseName)) {
      exercisesRun.push(exerciseName);
    }
    await supabase.from('reflection_sessions')
      .update({ exercises_run: exercisesRun, consecutive_excuses: consecutiveExcuses, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  } catch (_e) {}
}

async function queueFollowUp(userId, sessionId, { context, question, check_back_after, trigger_condition, type }, clientDate) {
  try {
    // SUPABASE MIGRATION NOTE: follow_up_queue requires a nullable `type` TEXT column.
    await supabase.from('follow_up_queue').insert({
      user_id: userId, session_id: sessionId, context, question,
      check_back_after: check_back_after || daysFromNow(3, clientDate),
      trigger_condition: trigger_condition || null,
      type: type || null,
    });
  } catch (_e) {}
}

async function markFollowUpTriggered(followUpId) {
  try {
    await supabase.from('follow_up_queue').update({ triggered: true }).eq('id', followUpId);
  } catch (_e) {}
}

// ── Progress event helpers ────────────────────────────────────────────────────

async function writeProgressEvent(userId, sessionId, eventType, payload) {
  try {
    await supabase.from('user_progress_events').insert({
      user_id: userId,
      session_id: sessionId || null,
      event_type: eventType,
      payload,
    });
  } catch (_e) {}
}

async function loadProgressEvents(userId) {
  try {
    const { data } = await supabase
      .from('user_progress_events')
      .select('id, event_type, payload, created_at')
      .eq('user_id', userId)
      .is('surfaced_at', null)
      .order('created_at', { ascending: false })
      .limit(5);
    return data || [];
  } catch (_e) { return []; }
}

async function markProgressEventSurfaced(eventId) {
  try {
    await supabase
      .from('user_progress_events')
      .update({ surfaced_at: new Date().toISOString() })
      .eq('id', eventId);
  } catch (_e) {}
}

async function upsertGrowthMarker(userId, theme, { exercise_run, check_in_message }, clientDate) {
  try {
    const { data: existing } = await supabase
      .from('growth_markers').select('id, occurrence_count, exercises_run, check_in_after')
      .eq('user_id', userId).eq('theme', theme).maybeSingle();
    if (existing) {
      const exercises = Array.isArray(existing.exercises_run) ? existing.exercises_run : [];
      if (exercise_run && !exercises.includes(exercise_run)) exercises.push(exercise_run);
      const newCount = (existing.occurrence_count || 1) + 1;
      await supabase.from('growth_markers').update({
        occurrence_count: newCount, exercises_run: exercises,
        check_in_after: newCount >= 3 && !existing.check_in_after ? daysFromNow(14, clientDate) : existing.check_in_after,
        check_in_message: check_in_message || null,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('growth_markers').insert({
        user_id: userId, theme,
        exercises_run: exercise_run ? [exercise_run] : [],
        occurrence_count: 1, check_in_message: check_in_message || null,
      });
    }
  } catch (_e) {}
}

// ── Vector search + profile evolution helpers ─────────────────────────────────

async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    });
    return response.data[0].embedding;
  } catch (_e) { return null; }
}

async function searchRelevantMemories(userId, queryText, matchCount = 3) {
  try {
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), 1500));
    const searchPromise = (async () => {
      const embedding = await generateEmbedding(queryText);
      if (!embedding) return [];
      const { data } = await supabase.rpc('match_reflection_sessions', {
        query_embedding: embedding,
        match_user_id: userId,
        match_count: matchCount,
      });
      return data || [];
    })();
    return await Promise.race([searchPromise, timeoutPromise]);
  } catch (_e) { return []; }
}

function generateSessionSummary(sessionState, result, profile, dateStr) {
  const name = profile.display_name || profile.full_name || 'them';
  const wins = Array.isArray(sessionState.wins)
    ? sessionState.wins.map((w) => (typeof w === 'string' ? w : w?.text)).filter(Boolean).join(', ')
    : (typeof sessionState.wins === 'string' ? sessionState.wins : result.extracted_data?.win_text || 'not recorded');
  const firstMiss = Array.isArray(sessionState.misses) && sessionState.misses.length > 0
    ? (typeof sessionState.misses[0] === 'string' ? sessionState.misses[0] : sessionState.misses[0]?.text)
    : (typeof sessionState.misses === 'string' ? sessionState.misses : null);
  const miss = result.extracted_data?.miss_text || firstMiss || null;
  const commitment = sessionState.tomorrow_commitment || result.extracted_data?.tomorrow_commitment || null;
  const insight = result.extracted_data?.depth_insight || sessionState.depth_insight || null;
  const exercises = Array.isArray(sessionState.exercises_run) ? sessionState.exercises_run.join(', ') : 'none';
  const mood = sessionState.mood_end_of_day || result.extracted_data?.mood || null;
  const blockers = Array.isArray(sessionState.blocker_tags) ? sessionState.blocker_tags.join(', ') : null;

  let summary = `Session ${dateStr}: ${name} worked on ${wins}.`;
  if (miss) summary += ` Honest moment: ${miss}.`;
  if (blockers) summary += ` Blockers: ${blockers}.`;
  if (commitment) summary += ` Tomorrow's plan: ${commitment}.`;
  if (insight) summary += ` Depth insight: ${insight}.`;
  if (exercises !== 'none') summary += ` Exercises: ${exercises}.`;
  if (mood) summary += ` Mood: ${mood}.`;
  return summary;
}

async function evolveUserProfile(userId, summaryText, currentProfile, recentSessions, sessionId) {
  try {
    // Check if a monthly deep pattern pass is due
    const lastUpdated = currentProfile?.profile_updated_at ? new Date(currentProfile.profile_updated_at) : null;
    const daysSinceUpdate = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)) : 999;
    const isMonthlyPassDue = daysSinceUpdate >= 30;

    let deepPatternContext = '';
    if (isMonthlyPassDue) {
      try {
        const { data: thirtyDaySessions } = await supabase
          .from('reflection_sessions')
          .select('date, summary, mood_end_of_day, tomorrow_commitment')
          .eq('user_id', userId)
          .not('summary', 'is', null)
          .order('date', { ascending: false })
          .limit(30);

        if (thirtyDaySessions && thirtyDaySessions.length >= 5) {
          const patternCompletion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `Analyze these 30 days of reflection session summaries and identify:
1. top_3_recurring_themes: themes mentioned 3+ times (max 3 strings)
2. mood_trend: "improving" | "stable" | "declining" based on mood data
3. commitment_followthrough_rate: rough % based on wins following commitments (0-100)
4. emerging_strengths: new strengths becoming consistent (max 3 strings)
5. persistent_blockers: blockers that keep showing up (max 3 strings)

Return ONLY valid JSON matching exactly:
{
  "top_3_recurring_themes": [],
  "mood_trend": "stable",
  "commitment_followthrough_rate": 0,
  "emerging_strengths": [],
  "persistent_blockers": []
}`,
              },
              {
                role: 'user',
                content: JSON.stringify(thirtyDaySessions.map((s) => ({
                  date: s.date,
                  summary: s.summary?.slice(0, 200),
                  mood: s.mood_end_of_day,
                  committed: !!s.tomorrow_commitment,
                }))),
              },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 300,
            temperature: 0.5,
          });
          deepPatternContext = patternCompletion.choices[0].message.content;
        }
      } catch (_e) { /* fail silently */ }
    }

    const EVOLVE_SYSTEM = `You are analyzing a completed reflection session to evolve the user's profile.

Given the session summary and current user profile, extract:
1. short_term_state: 1-2 sentences on how they're doing right now. Human language, not clinical. E.g. "He's been grinding on his app and working on his morning routine."
2. long_term_patterns: recurring themes/behaviors emerging (max 5 strings)
3. growth_areas: areas actively being worked on. Max 4 objects. Each object:
   { "label": "2-4 word name", "evidence": "One specific sentence: what they did, when, how it's shifting. Use dates if available. Their actual situation, not generic language.", "started": "YYYY-MM-DD or null" }
   Example: { "label": "Morning consistency", "evidence": "Went from skipping mornings entirely to 4/7 days in the last three weeks — the trend started after they committed to protecting pre-work hours.", "started": "2024-03-10" }
4. strengths: positive traits demonstrated with evidence. Max 4 objects. Each object:
   { "label": "2-4 word name", "evidence": "One specific sentence citing what they actually did — dates, events, their words where possible. Name the mechanism: what does this strength look like in action for them specifically.", "first_seen": "YYYY-MM-DD or null", "occurrence_count": number }
   Example: { "label": "Executes under pressure", "evidence": "Shipped the auth feature the same week they said they were exhausted and two days behind — this has shown up three times in the last month.", "first_seen": "2024-03-18", "occurrence_count": 3 }
5. values: core values surfaced in their language and choices (max 5 strings)
6. identity_statement_update: If the current value is null, derive one from this session. If non-null, update only if the session surfaces meaningfully new detail — otherwise null.
7. big_goal_update: If the current value is null, derive one from this session. If non-null, update only if the goal evolved or became clearer — otherwise null.
8. why_update: If the current value is null, derive one from this session. If non-null, update only if their why deepened or clarified — otherwise null.
9. blockers_update: ONLY if new blockers clearly emerged or existing ones evolved — otherwise null. Array of strings max 5.
10. future_self_update: If the current value is null, derive one from this session. If non-null, update only if the user expressed a clearer or evolved version of their 1-year vision — otherwise null.
11. goal_updates: array of { goal_id, why_insight, why_action, why_replace_index, vision_fragment, depth_insight, last_mentioned_date } for any goals that were meaningfully discussed. Only include fields that have new content — null otherwise. Empty array if no goals were discussed.
    - why_insight: the captured why text in their actual words (or null)
    - why_action: "add" | "replace" | null (add if new distinct motivation, replace if deeper version of existing)
    - why_replace_index: 0-based index of the why to replace (only set when why_action="replace")

Rules:
- Use their actual words, not clinical language
- For identity_statement/big_goal/why/future_self: always populate if currently null; update if non-null only when this session adds meaningful new detail
- Merge with existing profile — evolve, don't erase
- Keep arrays concise, quality over quantity

Return valid JSON only:
{
  "short_term_state": "...",
  "long_term_patterns": ["..."],
  "growth_areas": [{"label": "...", "evidence": "...", "started": "..."}],
  "strengths": [{"label": "...", "evidence": "...", "first_seen": "...", "occurrence_count": 0}],
  "values": ["..."],
  "identity_statement_update": "..." | null,
  "big_goal_update": "..." | null,
  "why_update": "..." | null,
  "blockers_update": ["..."] | null,
  "future_self_update": "..." | null,
  "goal_updates": []
}`;

    const recentSummaries = recentSessions
      .filter((s) => s.summary)
      .slice(0, 3)
      .map((s) => `${s.date}: ${s.summary}`)
      .join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: EVOLVE_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            session_summary: summaryText,
            current_profile: {
              name: currentProfile?.display_name || currentProfile?.full_name,
              identity_statement: currentProfile?.identity_statement,
              big_goal: currentProfile?.big_goal,
              why: currentProfile?.why,
              future_self: currentProfile?.future_self,
              short_term_state: currentProfile?.short_term_state,
              long_term_patterns: currentProfile?.long_term_patterns,
              growth_areas: currentProfile?.growth_areas,
              strengths: currentProfile?.strengths,
              values: currentProfile?.values,
            },
            recent_sessions: recentSummaries || 'none',
          }) + (deepPatternContext ? `\n\n## MONTHLY DEEP PATTERN ANALYSIS (use to enrich long_term_patterns and strengths):\n${deepPatternContext}` : ''),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1000,
    });

    const evolution = JSON.parse(completion.choices[0].message.content);

    const todayStr = new Date().toISOString().split('T')[0];
    const thirtyDaysAgoStr = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const sixtyDaysAgoStr = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];

    // ── Merge strengths — carry forward history, don't full-replace ───────
    const normLabel = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const existingStrengths = Array.isArray(currentProfile?.strengths) ? currentProfile.strengths : [];
    const aiStrengths = Array.isArray(evolution.strengths) ? evolution.strengths : [];
    const aiStrengthKeys = new Set(aiStrengths.map((s) => normLabel(s.label)));

    const mergedAiStrengths = aiStrengths.map((aiS) => {
      const existing = existingStrengths.find((e) => normLabel(e.label) === normLabel(aiS.label));
      return {
        label: aiS.label,
        evidence: aiS.evidence,
        first_seen: existing?.first_seen || aiS.first_seen || todayStr,
        occurrence_count: (existing?.occurrence_count || 0) + 1,
        last_seen: todayStr,
      };
    });
    // Keep established entries (occurrence_count >= 2) that weren't in this session's output
    const keptStrengths = existingStrengths
      .filter((e) => !aiStrengthKeys.has(normLabel(e.label)) && (e.occurrence_count || 0) >= 2)
      .map((e) => ({ ...e, last_seen: e.last_seen || todayStr }));
    const mergedStrengths = [...mergedAiStrengths, ...keptStrengths].slice(0, 6);

    // ── Merge growth_areas — keep established entries, carry started date ─
    const existingGrowthAreas = Array.isArray(currentProfile?.growth_areas) ? currentProfile.growth_areas : [];
    const aiGrowthAreas = Array.isArray(evolution.growth_areas) ? evolution.growth_areas : [];
    const aiGrowthKeys = new Set(aiGrowthAreas.map((g) => normLabel(g.label)));

    const mergedAiGrowthAreas = aiGrowthAreas.map((aiG) => {
      const existing = existingGrowthAreas.find((e) => normLabel(e.label) === normLabel(aiG.label));
      return {
        label: aiG.label,
        evidence: aiG.evidence,
        started: existing?.started || aiG.started || null,
        last_seen: todayStr,
      };
    });
    // Keep entries not in this session's output if they've been seen recently or have no last_seen yet (migration grace)
    const keptGrowthAreas = existingGrowthAreas
      .filter((e) => !aiGrowthKeys.has(normLabel(e.label)) && (!e.last_seen || e.last_seen >= sixtyDaysAgoStr))
      .map((e) => ({ ...e, last_seen: e.last_seen || todayStr }));
    const mergedGrowthAreas = [...mergedAiGrowthAreas, ...keptGrowthAreas].slice(0, 6);

    // ── Dedupe long_term_patterns ─────────────────────────────────────────
    const rawPatterns = Array.isArray(evolution.long_term_patterns) ? evolution.long_term_patterns : [];
    const seenPatterns = new Set();
    const dedupedPatterns = rawPatterns.filter((p) => {
      const key = normLabel(p);
      if (seenPatterns.has(key)) return false;
      seenPatterns.add(key);
      return true;
    });

    // ── Fire strength_resolved events for established strengths that faded ─
    for (const existing of existingStrengths) {
      if (
        !aiStrengthKeys.has(normLabel(existing.label)) &&
        (existing.occurrence_count || 0) >= 3 &&
        existing.last_seen && existing.last_seen < thirtyDaysAgoStr
      ) {
        (async () => {
          const { data: existingEvt } = await supabase
            .from('user_progress_events')
            .select('id')
            .eq('user_id', userId)
            .eq('event_type', 'strength_resolved')
            .contains('payload', { label: existing.label })
            .maybeSingle();
          if (!existingEvt) {
            await writeProgressEvent(userId, sessionId || null, 'strength_resolved', {
              label: existing.label,
              occurrence_count: existing.occurrence_count,
              first_seen: existing.first_seen,
              display_text: `"${existing.label}" has shown up ${existing.occurrence_count} times since ${existing.first_seen || 'your first session'}. It may be becoming second nature.`,
            });
          }
        })().catch(() => {});
      }
    }

    // ── Fire growth_area_resolved events for areas that have faded out ────
    for (const existing of existingGrowthAreas) {
      if (
        !aiGrowthKeys.has(normLabel(existing.label)) &&
        existing.last_seen && existing.last_seen < thirtyDaysAgoStr &&
        existing.started && existing.started < sixtyDaysAgoStr
      ) {
        (async () => {
          const { data: existingEvt } = await supabase
            .from('user_progress_events')
            .select('id')
            .eq('user_id', userId)
            .eq('event_type', 'growth_area_resolved')
            .contains('payload', { label: existing.label })
            .maybeSingle();
          if (!existingEvt) {
            await writeProgressEvent(userId, sessionId || null, 'growth_area_resolved', {
              label: existing.label,
              started: existing.started,
              display_text: `"${existing.label}" has been an active growth area since ${existing.started}. It looks like you've made real progress here.`,
            });
          }
        })().catch(() => {});
      }
    }

    const profileUpdates = {
      short_term_state: evolution.short_term_state,
      long_term_patterns: dedupedPatterns,
      growth_areas: mergedGrowthAreas,
      strengths: mergedStrengths,
      values: evolution.values,
      profile_updated_at: new Date().toISOString(),
    };
    if (evolution.identity_statement_update || !currentProfile?.identity_statement) {
      if (evolution.identity_statement_update) profileUpdates.identity_statement = evolution.identity_statement_update;
    }
    if (evolution.big_goal_update || !currentProfile?.big_goal) {
      if (evolution.big_goal_update) profileUpdates.big_goal = evolution.big_goal_update;
    }
    if (evolution.why_update || !currentProfile?.why) {
      if (evolution.why_update) profileUpdates.why = evolution.why_update;
    }
    if (evolution.blockers_update) profileUpdates.blockers = evolution.blockers_update;
    if (evolution.future_self_update || !currentProfile?.future_self) {
      if (evolution.future_self_update) profileUpdates.future_self = evolution.future_self_update;
    }

    await supabase.from('user_profiles').update(profileUpdates).eq('id', userId);

    // Write back goal updates from EVOLVE pass
    if (Array.isArray(evolution.goal_updates)) {
      for (const gu of evolution.goal_updates) {
        if (!gu.goal_id) continue;
        const goalUpdates = {};
        if (gu.vision_fragment) goalUpdates.vision_snapshot = gu.vision_fragment;
        if (gu.last_mentioned_date) goalUpdates.last_mentioned_at = gu.last_mentioned_date;

        // Handle why_insight — append to whys array (evolve pass always adds, never replaces blindly unless index given)
        if (gu.why_insight) {
          supabase
            .from('goals')
            .select('whys')
            .eq('id', gu.goal_id)
            .eq('user_id', userId)
            .maybeSingle()
            .then(({ data }) => {
              let currentWhys = Array.isArray(data?.whys) ? [...data.whys] : [];
              const newWhy = {
                text: gu.why_insight,
                added_at: gu.last_mentioned_date || new Date().toISOString().split('T')[0],
                source: 'evolve_pass',
                motivation_signal: null,
                session_id: null,
              };
              if (gu.why_action === 'replace' && typeof gu.why_replace_index === 'number' && currentWhys[gu.why_replace_index]) {
                currentWhys[gu.why_replace_index] = newWhy;
              } else {
                currentWhys.push(newWhy);
              }
              // Enforce retention policy
              const commitmentWhys = currentWhys.filter(w => w.source === 'commitment_planning').slice(-MAX_COMMITMENT_WHYS);
              const sessionWhys = currentWhys.filter(w => w.source !== 'commitment_planning').slice(-MAX_SESSION_WHYS);
              currentWhys = [...commitmentWhys, ...sessionWhys].slice(-MAX_WHYS_TOTAL);
              return supabase.from('goals').update({ ...goalUpdates, whys: currentWhys }).eq('id', gu.goal_id).eq('user_id', userId);
            })
            .then(() => {}).catch(() => {});
          if (!gu.depth_insight) continue; // why_insight handled above, skip simple update unless depth_insight also present
        }

        if (gu.depth_insight) {
          // Append depth insight — fetch first, then update
          supabase
            .from('goals')
            .select('depth_insights')
            .eq('id', gu.goal_id)
            .eq('user_id', userId)
            .maybeSingle()
            .then(({ data }) => {
              const current = Array.isArray(data?.depth_insights) ? data.depth_insights : [];
              const updated = [...current.slice(-MAX_DEPTH_INSIGHTS_RETAINED), { date: gu.last_mentioned_date || new Date().toISOString().split('T')[0], insight: gu.depth_insight }];
              return supabase.from('goals').update({ ...goalUpdates, depth_insights: updated }).eq('id', gu.goal_id).eq('user_id', userId);
            })
            .then(() => {}).catch(() => {});
          continue; // Skip simple update below since async above handles it
        }
        if (Object.keys(goalUpdates).length > 0) {
          supabase.from('goals').update(goalUpdates).eq('id', gu.goal_id).eq('user_id', userId).then(() => {}).catch(() => {});
        }
      }
    }
  } catch (_e) {}
}

/**
 * Synthesizes a why_summary for a goal from its current whys array using gpt-4o-mini.
 * Fire-and-forget — updates goals.why_summary.
 */
async function synthesizeGoalWhySummary(userId, goalId, goalTitle) {
  try {
    const { data } = await supabase
      .from('goals')
      .select('whys')
      .eq('id', goalId)
      .eq('user_id', userId)
      .maybeSingle();
    const whys = Array.isArray(data?.whys) ? data.whys : [];
    if (whys.length === 0) return;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Given these reasons a user has articulated for pursuing their goal '${sanitizeForPrompt(goalTitle, 100)}', write a single 2-3 sentence synthesis of their core motivation. Use their actual words where possible. Be specific, not generic. Return ONLY valid JSON: { "why_summary": "..." }`,
        },
        { role: 'user', content: JSON.stringify(whys.map(w => w.text)) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature: 0.5,
    });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    if (typeof parsed.why_summary === 'string' && parsed.why_summary.trim()) {
      await supabase
        .from('goals')
        .update({ why_summary: parsed.why_summary.trim() })
        .eq('id', goalId)
        .eq('user_id', userId);
    }
  } catch (_e) { /* fail silently */ }
}

// ── Session Directive Queue ───────────────────────────────────────────────────

/**
 * Rank active goals by priority for why-probe questions.
 * Higher score = better candidate to probe.
 */
function rankGoalsForWhyProbe(activeGoals, sessionWins, sessionMisses) {
  if (!Array.isArray(activeGoals) || activeGoals.length === 0) return [];

  const winTexts = (sessionWins || []).map(w => typeof w === 'string' ? w : w?.text || '').join(' ').toLowerCase();
  const missTexts = (sessionMisses || []).map(m => typeof m === 'string' ? m : m?.text || '').join(' ').toLowerCase();
  const combinedText = winTexts + ' ' + missTexts;

  return activeGoals
    .map(goal => {
      let score = 0;
      const whys = Array.isArray(goal.whys) ? goal.whys : [];
      const hasVision = !!goal.vision_snapshot;
      const hasWhy = whys.length > 0;
      const motivationSignal = goal.motivation_signal || 'unknown';
      const daysSinceMentioned = goal.days_since_mentioned ?? 999;

      // Has vision — rich context for Angle 2
      if (hasVision) score += 3;
      // Has a specific why — enables Angle 2
      if (hasWhy) score += 2;
      // Shallow why (only 1, short text) — good to deepen
      if (whys.length === 1 && (whys[0]?.text || '').length < 60) score += 1;
      // Low/struggling motivation — higher value to probe
      if (motivationSignal === 'struggling') score += 4;
      if (motivationSignal === 'low') score += 2;
      if (motivationSignal === 'unknown') score += 1;
      // Goal not mentioned recently
      if (daysSinceMentioned >= 7) score += 2;
      if (daysSinceMentioned >= 3) score += 1;

      // Title keyword overlap with today's wins/misses
      const titleWords = (goal.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = titleWords.filter(w => combinedText.includes(w)).length;
      score += overlap * 2;

      return { goal, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ goal }) => goal);
}

/**
 * Builds a prioritized array of coaching directive objects based on current session state.
 * Each directive maps to exactly one conditional instruction from the original instructions[] array.
 * Returns only directives whose condition is currently true, not already completed, and not already queued.
 */
function buildDirectiveQueue({
  preSessionState, isMemoryMode, followUpQueue, growthMarkers,
  intentData, suggestedPractice, depthProbeNeeded, sessionState,
  profile, commitmentStats, yesterdayCommitment, yesterdayMinimum, yesterdayStretch, yesterdayCheckinOpener,
  commitmentRate7Context, commitmentTrajectoryContext, avgCommitmentScoreContext, scoreTrajectoryContext,
  yesterdayFragments, enrichedYesterdayFragments,
  goalMissingWhy, messageCount, sessionReadyToClose, forceClose,
  honestMissing, suggestedNextStage,
  history,
  insightTriggeredExercise,
  userInsights, recentSessions, effectiveConsecutiveExcuses,
  currentDirectiveQueue, completedDirectives,
  activeGoals = [],
}) {
  const currentStage = sessionState.current_stage || 'commitment_checkin';
  const allDirectives = [];
  const derivedRate7 = commitmentStats?.rate7 != null ? Math.round(commitmentStats.rate7 * 100) : null;
  const rate = commitmentRate7Context !== null ? commitmentRate7Context : derivedRate7;
  const trajectory = commitmentTrajectoryContext ?? commitmentStats?.trajectory ?? null;
  const avgScore = avgCommitmentScoreContext ?? commitmentStats?.avgScore7 ?? null;
  const scoreTrajectory = scoreTrajectoryContext ?? commitmentStats?.scoreTrajectory ?? null;
  const mergedChecklist = { ...(sessionState.checklist || {}), ...(intentData?.checklist_content || {}) };
  const parsedCommitmentScore = Number(sessionState?.commitment_score);
  const commitmentScore = Number.isFinite(parsedCommitmentScore) ? parsedCommitmentScore : null;
  // Priority: explicit kept outcome > score-based >=50 > partial fallback when score is unavailable.
  const mostlyKeptCheckin = sessionState?.checkin_outcome === 'kept'
    || (commitmentScore !== null && commitmentScore >= 50)
    || (sessionState?.checkin_outcome === 'partial' && commitmentScore === null);

  // ── cold_start_opener ──────────────────────────────────────────────────
  if (preSessionState?.cold_start) {
    allDirectives.push({
      id: 'cold_start_opener',
      instruction: `COLD START (${preSessionState.days_since_last_session ?? 'many'} days away): Do NOT open generically. Reference the gap directly and warmly. ${preSessionState.returning_user_context ? `Last session context: "${preSessionState.returning_user_context}".` : ''} Open with something specific that shows you remember them and have been thinking about where they left off.`,
      priority: 1,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── init_follow_up ─────────────────────────────────────────────────────
  if (preSessionState?.follow_up_due && !preSessionState?.cold_start) {
    allDirectives.push({
      id: 'init_follow_up',
      instruction: `INIT FOLLOW-UP: A specific question was queued from their last session. Open with it naturally rather than a generic greeting. Context: "${preSessionState.follow_up_due.context}". Question: "${preSessionState.follow_up_due.question}".`,
      priority: 1,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── init_growth_marker ─────────────────────────────────────────────────
  if (preSessionState?.growth_marker_due && !preSessionState?.follow_up_due && !preSessionState?.cold_start) {
    allDirectives.push({
      id: 'init_growth_marker',
      instruction: `INIT GROWTH MARKER: Before offering mood chips, briefly surface the growth theme "${preSessionState.growth_marker_due.theme}" as a natural opener — e.g. "I've been thinking about [theme] and wanted to check in on that tonight." Do not announce it as a scheduled check-in.`,
      priority: 1,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── practice_hint ──────────────────────────────────────────────────────
  if (preSessionState?.suggested_practice && !preSessionState?.cold_start) {
    allDirectives.push({
      id: 'practice_hint',
      instruction: `PRACTICE HINT: Tonight's recommended practice is "${preSessionState.suggested_practice}" (reason: ${preSessionState.suggested_practice_reason}). If momentum and tone align, guide the session toward this practice. Do not force it — wait for a natural opening.`,
      priority: 2,
      preferred_stage: 'any',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── returning_user_context ─────────────────────────────────────────────
  if (preSessionState && !preSessionState.cold_start && preSessionState.returning_user_context && !preSessionState.follow_up_due && !preSessionState.growth_marker_due) {
    allDirectives.push({
      id: 'returning_user_context',
      instruction: `RETURNING USER: Briefly acknowledge where they left off before offering mood chips. Context: "${preSessionState.returning_user_context}". One warm sentence — then move into the normal opener.`,
      priority: 1,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── memory_mode ────────────────────────────────────────────────────────
  if (isMemoryMode) {
    allDirectives.push({
      id: 'memory_mode',
      instruction: `MEMORY MODE: The user asked a question or wants advice. PAUSE the stage workflow — do NOT advance stage or update checklist. Answer their question directly using relevant_memories and their profile data. Use their actual past words and patterns. Be specific, not generic. End your response with ONE question that naturally brings them back to the ${currentStage} stage.`,
      priority: 1,
      preferred_stage: 'any',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── follow_up_surface ──────────────────────────────────────────────────
  if (followUpQueue) {
    // Opening follow-up (first __INIT__ message) is fine at priority 1/wins.
    // Mid-session follow-up surfacing competes with real work — drop to priority 2/honest.
    // priority 1 = high (fires before most directives); priority 2 = normal
    const isInitMessage = !messageCount || messageCount === 0;
    allDirectives.push({
      id: 'follow_up_surface',
      instruction: 'PRIORITY: Surface follow_up_due question first.',
      priority: isInitMessage ? 1 : 2,
      preferred_stage: isInitMessage ? 'wins' : 'honest',
      fire_next_session: true,
      followup_question: 'How did things go with what you were working through last time — has anything shifted since then?',
      energy_type: 'reflective',
    });
  }

  // ── growth_marker_weave ────────────────────────────────────────────────
  if (growthMarkers) {
    allDirectives.push({
      id: 'growth_marker_weave',
      instruction: 'Weave in growth_marker_due check-in naturally.',
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: 'I wanted to check in on something — you were working through a theme last time. How has that been sitting with you?',
      energy_type: 'reflective',
    });
  }

  // ── anti_excuse ────────────────────────────────────────────────────────
  if (intentData?.accountability_signal === 'excuse') {
    allDirectives.push({
      id: 'anti_excuse',
      instruction: `ANTI-EXCUSE: consecutive_excuses=${effectiveConsecutiveExcuses}. Use their specific words. Follow the protocol.`,
      priority: 1,
      preferred_stage: 'any',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── run_exercise ───────────────────────────────────────────────────────
  if (suggestedPractice !== 'none') {
    allDirectives.push({
      id: 'run_exercise',
      instruction: `RUN: ${suggestedPractice}. Fill ALL placeholders with user's actual words — never output [bracket placeholders]. Set exercise_run="${suggestedPractice}". REQUIRED: Before the exercise question, write 2-3 sentences explaining (1) what you specifically noticed in this conversation that made you choose this exercise right now — be concrete, reference their actual words or pattern, (2) what type of insight or shift this will likely surface for them, and (3) the angle or mindset to bring to get the most out of it. Never skip this setup. Never go straight to the question. Never name the exercise by label.`,
      priority: 2,
      preferred_stage: 'any',
      fire_next_session: false,
      energy_type: 'depth',
    });
  }

  if (insightTriggeredExercise) {
    allDirectives.push({
      id: 'insight_triggered_exercise',
      exercise_id: insightTriggeredExercise.exerciseId,
      insight_context: insightTriggeredExercise.insightContext,
      insight_match_context: insightTriggeredExercise.insightContext,
      insight_id: insightTriggeredExercise.insightId,
      instruction: `INSIGHT-MATCHED EXERCISE: The user just said something that matches a known pattern: "${insightTriggeredExercise.insightContext}". Consider opening with: "${EXERCISE_FIRST_TIME_INTROS[insightTriggeredExercise.exerciseId] || 'I want to try something here.'}" then run "${insightTriggeredExercise.exerciseId}" now. Set exercise_run="${insightTriggeredExercise.exerciseId}". Include chips: [{"label":"Let's go there","value":"exercise_accept"},{"label":"Keep going","value":"exercise_skip"}].`,
      priority: 1.5,
      preferred_stage: sessionState?.insight_exercise_skipped ? 'close' : 'any',
      fire_next_session: true,
      followup_question: `I want to come back to something we touched — ${insightTriggeredExercise.insightContext}`,
      energy_type: 'depth',
    });
  }

  // ── depth_probe ────────────────────────────────────────────────────────
  if (depthProbeNeeded) {
    allDirectives.push({
      id: 'depth_probe',
      instruction: `DEPTH OPPORTUNITY: The user's message has depth potential. Before asking the depth question, briefly signal the pivot in one phrase — e.g. "I want to go underneath that for a second" or "there's something worth understanding here" — then ask WHY or surface the belief underneath what they just said. The framing makes the question land with intention rather than feeling random. Use a depth_probe question naturally. Set exercise_run="depth_probe". Store any insight in extracted_data.depth_insight. IMPORTANT: Do NOT frame this as goal-specific unless the user is directly referencing a goal — keep depth probes grounded in what the user just said.`,
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: 'I want to come back to what you were exploring last time — did anything new come up around that after we talked?',
      energy_type: 'depth',
    });
  }

  // ── wins_invite_more ───────────────────────────────────────────────────
  if (
    currentStage === 'wins' &&
    mergedChecklist.wins === true &&
    !sessionState.wins_asked_for_more
  ) {
    allDirectives.push({
      id: 'wins_invite_more',
      instruction: `WINS — INVITE MORE: The user just shared a win. Do NOT ask an identity question, depth question, or stage-transition question yet. Your only job right now is to invite them to share more wins. Ask exactly one open question: something like "What else went well?" or "What's another one?" or "What else are you proud of today?" — keep it short and warm. Set wins_asked_for_more: true. Do NOT advance to the next stage until this is done.`,
      priority: 1,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'momentum',
    });
  }

  // ── wins_callback ──────────────────────────────────────────────────────
  if (Array.isArray(sessionState.wins) && sessionState.wins.length > 0 && currentStage !== 'wins' && currentStage !== 'close') {
    const winsText = sessionState.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean).join(', ');
    allDirectives.push({
      id: 'wins_callback',
      instruction: `CALLBACK: The user mentioned these wins earlier: ${winsText}. If relevant, reference these by name when asking about follow-through or identity. Never re-ask what you already know.`,
      priority: 3,
      preferred_stage: 'honest',
      fire_next_session: false,
      energy_type: 'momentum',
    });
  }

  // ── depth_callback ─────────────────────────────────────────────────────
  if (sessionState.depth_insight && !sessionReadyToClose) {
    allDirectives.push({
      id: 'depth_callback',
      instruction: `DEPTH CALLBACK: Earlier the user surfaced this insight: "${sessionState.depth_insight}". If a natural moment arises (especially in 'close' stage), reflect it back to them once — e.g. "You said earlier [insight]. What does that mean for how you show up tomorrow?" Do this once only, warmly. When you bring it back, briefly anchor why: e.g. "I want to come back to something you said earlier — because I think it's the most important thing from tonight" or "Before we close, this is the thing I don't want to lose." Then reflect it back.`,
      priority: 2,
      preferred_stage: 'close',
      fire_next_session: false,
      energy_type: 'depth',
      close_order: 1,
    });
  }

  // ── reference_shared ──────────────────────────────────────────────────
  {
    const capturedWins = Array.isArray(sessionState.wins)
      ? sessionState.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean)
      : [];
    const capturedMisses = Array.isArray(sessionState.misses)
      ? sessionState.misses.map(m => typeof m === 'string' ? m : m?.text).filter(Boolean)
      : [];
    const capturedBlockers = Array.isArray(sessionState.blocker_tags) ? sessionState.blocker_tags : [];
    if (capturedWins.length > 0 || capturedMisses.length > 0 || capturedBlockers.length > 0) {
      allDirectives.push({
        id: 'reference_shared',
        instruction: `REFERENCE WHAT THEY SAID: The user has already shared: wins=[${capturedWins.join(', ')}], misses=[${capturedMisses.join(', ')}], blockers=[${capturedBlockers.join(', ')}]. Your next question MUST reference at least one of these specifically. Never ask a generic question when you have their real words.`,
        priority: 1,
        preferred_stage: 'any',
        fire_next_session: false,
        energy_type: 'planning',
      });
    }
  }

  // ── why_missing ────────────────────────────────────────────────────────
  if (goalMissingWhy && !sessionReadyToClose && !forceClose) {
    const missedLast7Text = goalMissingWhy.commitment_stats?.rate_last_7 != null
      ? ` Their fragment commitments for ${goalMissingWhy.title} have been missed ${Math.round((1 - goalMissingWhy.commitment_stats.rate_last_7) * 100)}% of the time in the last 7 days.`
      : '';
    allDirectives.push({
      id: 'why_missing',
      instruction: `WHY MISSING (HIGHEST PRIORITY): The goal "${goalMissingWhy.title}" (id: ${goalMissingWhy.id}) has never had a why captured.${missedLast7Text} If any natural moment exists this session — especially during wins, honest, or when this goal comes up — ask what makes it actually matter. When you ask it, briefly frame why it matters: e.g. "I've never actually heard what makes ${goalMissingWhy.title} real for you — not the goal itself, but what's underneath it" or "The reason I'm asking is that the why is what keeps the goal alive when the motivation dips." One sentence of framing, then the question. Use their words and context, not generic language. When they answer, you MUST set extracted_data.goal_why_insight to their response, extracted_data.goal_why_action to "add", and extracted_data.goal_id_referenced to exactly "${goalMissingWhy.id}". Do not skip setting goal_id_referenced — without it the why is silently lost. Don't force it if the goal hasn't come up.`,
      priority: 1,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: `I wanted to ask — what makes ${goalMissingWhy.title} actually matter to you? Not the goal itself, but what's underneath it.`,
      energy_type: 'planning',
    });
  }

  // ── honest_missing ─────────────────────────────────────────────────────
  if (honestMissing && !mostlyKeptCheckin) {
    const patternHint = userInsights.length > 0
      ? `Their recurring pattern is "${userInsights[0].pattern_label}" — if it came up today, help them name it. E.g. "Did ${userInsights[0].pattern_label.replace(/_/g, ' ')} show up anywhere today?" or "Was there a moment where you held back and you're not sure why?"`
      : `E.g. "Where did you feel like you weren't fully showing up today?" or "Is there a moment from today that's still sitting with you?" or "What part of today are you least proud of — not what you'd fix, just what happened?"`;
    const topBlockerInsight = (userInsights || []).find((i) => i.pattern_type === 'blocker');
    let patternContext = '';
    if (topBlockerInsight) {
      patternContext = `\n\nPATTERN CONTEXT: Their top identified blocker pattern is "${topBlockerInsight.pattern_label}". Trigger: "${topBlockerInsight.trigger_context || 'unclear'}". If what they share tonight clearly connects to this pattern, name it explicitly: "That sounds like the ${topBlockerInsight.pattern_label} pattern coming up — is that what's happening?" Don't force it if the connection isn't clear. But when it is clear, say it.`;
    }
    const missedFragmentContext = (() => {
      if (!['missed', 'partial'].includes(sessionState?.checkin_outcome)) return '';

      // Try enriched fragment first (has goal + why context)
      const linkedFragments = (enrichedYesterdayFragments || []).filter(f => f.goal_id && f.goal_why_context);
      if (linkedFragments.length > 0) {
        const top = linkedFragments[0];
        const safeCommitment = sanitizeForPrompt(top.commitment_text, 120);
        const safeGoalTitle = sanitizeForPrompt(top.goal_title, 80);
        const safeWhy = sanitizeForPrompt(top.goal_why_context, 120);
        return `\n\nCOMMITMENT MISS ANCHOR: Yesterday they committed to "${safeCommitment}" as part of their goal "${safeGoalTitle}". They said it was about "${safeWhy}". They ${sessionState.checkin_outcome === 'missed' ? 'fully missed it' : 'partially completed it'}. Open the honest stage by naming this directly: reference the specific commitment and what it was tied to. Then ask what got in the way — not generically, but specifically about this commitment.`;
      }

      // Fallback: plain commitment text with no goal context
      const plainCommitment = sanitizeForPrompt(yesterdayCommitment, 120);
      if (plainCommitment) {
        return `\n\nCOMMITMENT MISS ANCHOR: Yesterday they committed to "${plainCommitment}" and ${sessionState.checkin_outcome === 'missed' ? 'fully missed it' : 'only partially completed it'}. Open the honest stage by naming this commitment specifically. Ask what got in the way of that — not a generic miss probe, but anchored to what they actually said they'd do.`;
      }

      return '';
    })();
    allDirectives.push({
      id: 'honest_missing',
      instruction: `HONEST MISSING: Gently probe for a miss or honest moment with self-awareness questions. ${patternHint} Goal is self-awareness about TODAY, not action planning. Do NOT ask "what would you do differently" — that belongs in tomorrow. Weave it naturally. Once a miss is named, ask the one question that goes underneath it — what was actually happening underneath that surface behavior, not just what they did or didn't do. Do NOT set honest_depth: true until the user has genuinely answered the underneath layer. A surface answer is not enough. Evaluate qualitatively: is this a real answer about why it happened — the actual reason, the emotional truth, the internal conflict? If yes → set honest_depth: true. If no → ask the one question that goes there. When probing for the honest moment, you can briefly frame what this part of the session is for — e.g. "Before we talk about tomorrow, I want to make sure we've gone there — the part of today that's worth being honest about" or "This is the part most people skip, but it's usually the most useful." Keep it to one sentence — then ask.${patternContext}${missedFragmentContext}`,
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: 'Before we close — was there a moment from last time that\'s still sitting with you, something you didn\'t fully land on?',
      energy_type: 'depth',
    });
  }

  // ── honest_why_growth ──────────────────────────────────────────────────
  if (
    currentStage === 'honest' &&
    hasMissInSession &&
    !sessionState.honest_depth &&
    !completedDirectives.includes('honest_why_growth')
  ) {
    const missText = typeof sessionState.misses?.[0] === 'string'
      ? sanitizeForPrompt(sessionState.misses[0], 120)
      : sanitizeForPrompt(sessionState.misses?.[0]?.text, 120);

    const whyAlreadySurfaced = !!(
      sessionState.depth_insight ||
      sessionState.goal_why_insight ||
      (Array.isArray(sessionState.misses) && sessionState.misses.some(m => {
        const text = typeof m === 'string' ? m : m?.text || '';
        return text.length > 80; // rough signal they went deep in their miss description
      }))
    );

    if (!whyAlreadySurfaced) {
      const missAnchor = missText
        ? `They just named this as their miss or gap: "${missText}". `
        : '';
      allDirectives.push({
        id: 'honest_why_growth',
        instruction: `WHY GROWTH MATTERS: ${missAnchor}Now ask why getting better at this specific thing matters to them — not in a generic way, but tied to what they just said. E.g. "Why does getting better at [what they named] actually matter to you?" or "What would it mean for you if you stopped getting stuck on [this]?" One question only. Do NOT ask this if they've already explained why it matters to them in their previous message — evaluate whether their last message already contained a genuine answer about personal stakes. If it did, skip this and set honest_depth: true instead. If not, ask the question and wait for the answer before setting honest_depth: true.`,
        priority: 2,
        preferred_stage: 'honest',
        fire_next_session: false,
        energy_type: 'depth',
      });
    }
  }

  // ── honest_why_probe ─────────────────────────────────────────────────────
  const honestWhyProbesDone = completedDirectives.filter(id => id.startsWith('honest_why_probe_')).length;
  const canRunHonestWhyProbe =
    currentStage === 'honest' &&
    sessionState.honest_depth === true &&
    honestWhyProbesDone < MAX_WHY_PROBES_PER_STAGE &&
    !completedDirectives.includes(`honest_why_probe_${honestWhyProbesDone + 1}`);

  if (canRunHonestWhyProbe) {
    const rankedGoals = rankGoalsForWhyProbe(
      activeGoals,
      sessionState.wins,
      sessionState.misses
    );
    const probeGoals = rankedGoals.slice(0, MAX_WHY_PROBES_PER_STAGE);

    if (probeGoals.length > 0) {
      const probeIndex = honestWhyProbesDone;
      const targetGoal = probeGoals[probeIndex];
      if (targetGoal) {
        const safeTitle = sanitizeForPrompt(targetGoal.title, 80);
        const safeWhy = sanitizeForPrompt(
          Array.isArray(targetGoal.whys) && targetGoal.whys.length > 0
            ? targetGoal.whys[targetGoal.whys.length - 1]?.text
            : '',
          120
        );
        const safeVision = sanitizeForPrompt(targetGoal.vision_snapshot || '', 120);
        const probeId = `honest_why_probe_${probeIndex + 1}`;

        allDirectives.push({
          id: probeId,
          instruction: `HONEST WHY PROBE (${probeIndex + 1} of up to ${MAX_WHY_PROBES_PER_STAGE}): Ask ONE why-probe question about the goal "${safeTitle}", grounded in what they missed or struggled with today.${safeVision ? ` Vision context: "${safeVision}".` : ''}${safeWhy ? ` Stated why: "${safeWhy}".` : ''} 
Select the angle that fits the richest available data (see GOAL WHY-PROBE QUESTIONS in your instructions). Use misses/blockers as the action anchor, not wins.
Angles used so far this session are tracked — do not repeat an angle.
Available angles: (1) Action→Goal progress (miss version), (2) Action→Long-term self${safeVision ? ' [vision available]' : ''}${safeWhy ? ' [why available]' : ''}, (3) How they actually feel.
Ask one natural, specific question. Do NOT prefix with meta-framing.
After the user responds: if meaningful motivation revealed → set goal_why_probe_insight: {goal_id: "${targetGoal.id}", text: <their words>, action: "replace"|"add"|null, replace_index: <number or null>}. Otherwise set goal_why_probe_insight: null.
Set directive_completed: "${probeId}" when done.`,
          priority: 2,
          preferred_stage: 'honest',
          fire_next_session: false,
          energy_type: 'depth',
        });
      }
    }
  }

  // ── honest_kept_expansion ──────────────────────────────────────────────
  if (
    !mergedChecklist.honest &&
    mostlyKeptCheckin &&
    !completedDirectives.includes('honest_kept_expansion')
  ) {
    const keptFragmentContext = (() => {
      // Try enriched fragment first
      if (sessionState?.checkin_outcome === 'kept') {
        const linkedFragments = (enrichedYesterdayFragments || []).filter(f => f.goal_id && f.goal_why_context);
        if (linkedFragments.length > 0) {
          const top = linkedFragments[0];
          const safeCommitment = sanitizeForPrompt(top.commitment_text, 120);
          const safeGoalTitle = sanitizeForPrompt(top.goal_title, 80);
          const safeWhy = sanitizeForPrompt(top.goal_why_context, 120);
          return `\n\nCOMMITMENT WIN ANCHOR: They fully kept their commitment to "${safeCommitment}" (goal: "${safeGoalTitle}"). They said it was about "${safeWhy}". When you celebrate, connect it to the why: "You said this was about [why] — you actually showed up for that. What's that worth to you?" Use only if tone supports it.`;
        }
        // Fallback: plain commitment text
        const plainCommitment = sanitizeForPrompt(yesterdayCommitment, 120);
        if (plainCommitment) {
          return `\n\nCOMMITMENT WIN ANCHOR: They kept their commitment to "${plainCommitment}". Name it specifically when you celebrate — don't be generic.`;
        }
      }
      return '';
    })();
    allDirectives.push({
      id: 'honest_kept_expansion',
      instruction: `HONEST (KEPT): They fully or mostly completed their commitment (score >= 50). Start by naming what they did complete. If score is 100 (fully completed), do NOT ask about misses — go deeper on what made the follow-through happen. If score is 50-99 (partial), acknowledge the follow-through first, then gently ask what broke on the unfinished part. Example: "You still followed through on a solid chunk — what helped you get that part done?" then "And what got in the way of the rest?" Extract a depth insight from the mechanism, not just the miss. Set honest_depth: true once you have a real answer.${keptFragmentContext}`,
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: false,
      energy_type: 'depth',
    });
  }

  // ── commitment_checkin ─────────────────────────────────────────────────
  const yc = sessionState.yesterday_commitment || yesterdayCommitment;
  const isCheckinNeeded = !sessionState.commitment_checkin_done && !!yc;
  const isTransitioningToCheckin = currentStage === 'wins' && isCheckinNeeded;
  if ((currentStage === 'commitment_checkin' || isTransitioningToCheckin) && !sessionState.commitment_checkin_done && yc) {
      const minimumText = yesterdayMinimum ? `\n- Yesterday's MINIMUM floor: "${yesterdayMinimum}"` : '';
      const stretchText = yesterdayStretch ? `\n- Yesterday's STRETCH target: "${yesterdayStretch}"` : '';
      const checklistFragments = Array.isArray(yesterdayFragments)
        ? yesterdayFragments.map((f) => ({
            id: f.id,
            type: f.type || null,
            text: formatChecklistFragmentText(f),
          }))
        : [];
      const effectiveEnrichedFragments = enrichedYesterdayFragments || yesterdayFragments || [];
      const checklistText = checklistFragments.length > 0
        ? (() => {
            const fragmentsWithGoals = checklistFragments.map((f) => {
              const enriched = effectiveEnrichedFragments.find(ef => ef.id === f.id);
              if (enriched?.goal_title && enriched?.goal_why_context) {
                return `${JSON.stringify(f)} → goal: "${sanitizeForPrompt(enriched.goal_title, 80)}", why: "${sanitizeForPrompt(enriched.goal_why_context, 100)}"`;
              }
              return JSON.stringify(f);
            });
            return `\n- Yesterday's fragment checklist to show in UI: ${JSON.stringify(checklistFragments)}\n- Present the checklist by returning show_commitment_checklist: true and checklist_fragments as an array of {id, text, type} objects from the fragments below.\n- When a fragment has type="minimum" or type="stretch", keep that type and label intact in checklist_fragments so the user can see exactly which is minimum vs stretch.\n- Do NOT ask a free-text question. Wait for the user to submit the checklist.\n- After the user submits the checklist, use the submitted results + precomputed_commitment_score from context to set extracted_data.checkin_outcome (kept/partial/missed), set extracted_data.commitment_score, set commitment_checkin_done: true, and continue naturally.\n- GOAL CONTEXT per fragment (use to personalize the check-in tone — do NOT recite this verbatim): ${fragmentsWithGoals.join(' | ')}\n- When a fragment has a goal+why attached: after the user marks checklist, your follow-up acknowledgment can reference the why — e.g. "You said this was about [why] — what happened with that?" Use this only if it flows naturally.\n- FRAGMENT-GOAL CONTEXT: If any fragment has goal+why context, after the checklist result comes in, use the why to ask a pointed follow-up. E.g. "You said yesterday that working on [commitment] was about [why] — does how today went change anything about that?" Do NOT ask this for every fragment — pick the most resonant one only.`;
          })()
        : '\n- No fragment checklist is available for yesterday, so use the normal free-text check-in question flow.';
      let checkinTone = '';
      if (rate !== null && rate < 40) {
        checkinTone = `\n\nTONE: Their follow-through has been inconsistent lately (${rate}%). Ask how it went with genuine curiosity, no assumption either way. If they missed it, go there with them and get specific about what got in the way. If they did it, celebrate it. Don't lead with skepticism.`;
      } else if (rate !== null && rate >= 70) {
        checkinTone = `\n\nTONE: They've been strong at ${rate}% follow-through. Open from belief — "How did [commitment] go?" is enough. Let them tell you.`;
      } else if (trajectory === 'declining') {
        checkinTone = `\n\nTONE: Follow-through is declining. After they answer, if they missed it, don't move on — ask "What specifically got in the way?" We need the real blocker named before advancing stage.`;
      }
      allDirectives.push({
        id: 'commitment_checkin',
        instruction: `## COMMITMENT CHECK-IN\nYou are checking in on yesterday right after their mood response.\n- Yesterday's commitment to reference naturally: "${yc}"${minimumText}${stretchText}${checklistText}\n- This is the FIRST thing you address after mood. Ask how it went in a natural, direct way that feels like catching up — not evaluating performance.\n- Reference what they committed to, but do NOT open with a formal template like "you said you'd [X]". Keep it conversational and human.\n- If yesterday has a custom opener, use it exactly once before your question: ${yesterdayCheckinOpener ? `"${yesterdayCheckinOpener}"` : '(none available)'}\n- Use their exact words from the commitment. Never ask a generic or identity-style question.\n- If doing free-text fallback (no checklist), ask exactly ONE specific question and then wait.\n- If checklist fragments are available, you MUST show the checklist (show_commitment_checklist: true) and MUST NOT ask a free-text question.\n- On this transition turn from wins, set stage_advance:true and new_stage:"commitment_checkin" so the UI reflects the check-in stage immediately.\n- Never ask twice. One exchange only. Always set commitment_checkin_done: true after their response, regardless of outcome.\n- ROUTING AFTER CHECK-IN: if commitment_score >= 50, set stage_advance:true and new_stage:"wins". If commitment_score < 50 (or score is unknown), set stage_advance:true and new_stage:"honest".${checkinTone}`,
        priority: 1,
        preferred_stage: isTransitioningToCheckin ? 'wins' : 'commitment_checkin',
        fire_next_session: false,
        energy_type: 'momentum',
      });
  }

  if (currentStage === 'commitment_checkin' && !sessionState.commitment_checkin_done && !yc) {
    allDirectives.push({
      id: 'commitment_checkin',
      instruction: `## STAGE: COMMITMENT CHECK-IN\nNo yesterday commitment is available. This stage is still a real check-in.\n- Respond directly to what they just shared about how they are feeling right now.\n- Ask one specific follow-up only if needed to clarify what is most present for them.\n- Use plain human language. Ask how they're doing, what's going on, or what kind of day it has been.\n- Do NOT use coaching-speak templates like "what feels most present for you," "what's coming up for you," or "where are you at energetically."\n- Do NOT mention that there is "nothing to check in on" and do NOT use generic form language.\n- Once you've captured their current state, set commitment_checkin_done: true.\n- The server will route to honest-first when their state sounds heavy/stuck/stressed, otherwise wins-first. Focus on the quality of the check-in message.`,
      priority: 1,
      preferred_stage: 'commitment_checkin',
      fire_next_session: false,
      energy_type: 'momentum',
    });
  }

  // ── commitment_specificity ────────────────────────────────────────────
  if (
    currentStage === 'tomorrow' &&
    sessionState.commitment_minimum &&
    !sessionState.commitment_stretch &&
    !completedDirectives.includes('commitment_specificity')
  ) {
    allDirectives.push({
      id: 'commitment_specificity',
      instruction: `COMMITMENT SPECIFICITY CHECK: The user just stated their minimum commitment: "${sessionState.commitment_minimum}". Before moving to the stretch question, evaluate whether this minimum is genuinely specific. A specific minimum commitment must have: (1) a WHEN — a day and time, not just "tomorrow" or "this week", (2) a clear first action — not aspirational language like "work on X" or "focus on Y". If the commitment is vague, push back directly and warmly — this is your one chance before the session closes. Say something like: "That's a start — but when exactly? Give me a day, a time, and the first thing you'll actually do." or "Be honest — is that specific enough to actually happen, or does it need a time and a first step?" Do NOT accept vague minimums. Push back once, clearly, then wait. If they sharpen it, update commitment_minimum in extracted_data with the improved version and set directive_completed: "commitment_specificity". If the minimum is already specific (has a time anchor and a concrete first action), set directive_completed: "commitment_specificity" immediately and proceed. Do NOT ask the stretch question until this check is complete. STRICT: Only mark directive_completed: "commitment_specificity" if they gave you a specific time AND a first action. If they deflected or stayed vague, push back ONE more time and do NOT mark complete. If they pushed back twice, accept and mark complete with a note to the user that we'll work on specificity over time.`,
      priority: 1,
      preferred_stage: 'tomorrow',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── tomorrow_commitment_structure ─────────────────────────────────────
  if (currentStage === 'tomorrow' && !sessionState.tomorrow_commitment) {
    const minimumCaptured = !!sessionState.commitment_minimum;
    const stretchCaptured = !!sessionState.commitment_stretch;
    const latestScore = (commitmentStats?.recentScores || []).slice(-1)[0];
    const lowScoreNudge = (commitmentStats?.avgScore7 != null && commitmentStats.avgScore7 < 60)
      || (latestScore != null && latestScore < 60);
    const honestMomentRaw = sessionState?.misses?.[0];
    const honestMoment = typeof honestMomentRaw === 'string' ? honestMomentRaw : honestMomentRaw?.text;
    let minimumFraming;
    if (rate !== null && rate < 50) {
      minimumFraming = `Name the data directly: "You've hit ${rate}% of your commitments recently. So let's get the floor right — what do you absolutely know you can get done tomorrow, no matter what?" Say the number first. Framing is certainty over ambition.`;
    } else if (avgScore !== null && avgScore < 55 && scoreTrajectory === 'declining') {
      minimumFraming = `Their commitment confidence has been scoring ${Math.round(avgScore)}/100 and declining — they keep setting bars too high and missing them. Ask: "What are all the core things you'd stake your reputation on finishing tomorrow to make it a productive day?" High-stakes framing forces real commitment, not hopeful thinking.`;
    } else if (trajectory === 'improving' && rate !== null && rate >= 60) {
      minimumFraming = `They're trending up (${rate}%, improving). Ask: "You're on a roll — what's the floor that protects tomorrow's streak no matter what comes up?" Frame it as protecting momentum.`;
    } else if (avgScore !== null && avgScore >= 80 && rate !== null && rate >= 70) {
      minimumFraming = `They've been hitting ${rate}% with avg confidence ${Math.round(avgScore)}/100. Don't make the minimum too easy. Ask: "Given you've been nailing your commitments, what would make tomorrow a genuinely hard win?" Raise the standard.`;
    } else {
      minimumFraming = honestMoment
        ? `They just admitted "${honestMoment.slice(0, 60)}...". Use it: "Okay — what are the specific tasks you're actually doing tomorrow? Walk me through the list." Reference the honest moment once as framing, then ask for concrete tasks, not themes.`
        : `Ask: "What are the specific things you're actually doing tomorrow — walk me through the list. Start with everything you know needs to happen." Emphasize tasks and actions, not themes or intentions.`;
    }
    allDirectives.push({
      id: 'tomorrow_commitment_structure',
      instruction: `TOMORROW COMMITMENT STRUCTURE: HARD RULE — You MUST NEVER set extracted_data.tomorrow_commitment until BOTH extracted_data.commitment_minimum AND extracted_data.commitment_stretch have been captured in separate exchanges. tomorrow_commitment is assembled server-side from both fields; do NOT set it directly before both exist.
- If the user states anything hedged — "I'll try", "I'll aim to", "maybe", "sometime", "probably", "when I feel ready", "hopefully", "if I have time" — this is NOT a minimum. Push back once: "That's an intention, not a floor commitment. What's the one thing you WILL do — not might, will?"
- commitment_minimum and commitment_stretch are separate fields. Never set tomorrow_commitment directly — only set commitment_minimum and commitment_stretch.
- Capture TWO commitments in sequence — never both at once.
- First capture the complete set of floor commitments with this opening framing (you may paraphrase while keeping intent): "Let's build out tomorrow. What are all the things that, if you got them done, would make tomorrow a real win — the floor you wouldn't fall below?" Store it in extracted_data.commitment_minimum.
- Minimum framing guidance: ${minimumFraming}
- On the turn you ask/capture minimum, do NOT set extracted_data.commitment_stretch and do NOT set extracted_data.tomorrow_commitment. Wait for the next user reply.
- Only AFTER minimum is captured and the specificity directive is completed, ask the stretch question: "Now push it — if tomorrow went as well as it possibly could, what would you have gotten done on top of that?" Store it in extracted_data.commitment_stretch.
- Current captured state: minimum=${minimumCaptured ? `"${sessionState.commitment_minimum}"` : 'null'}, stretch=${stretchCaptured ? `"${sessionState.commitment_stretch}"` : 'null'}.
- STRICT ORDER: extracted_data.tomorrow_commitment MUST be set only after BOTH extracted_data.commitment_minimum and extracted_data.commitment_stretch already exist (from this turn or prior turns).
- Once BOTH exist, set extracted_data.tomorrow_commitment to a combined summary (e.g. "Minimum: [minimum]. Stretch: [stretch].") and continue naturally.
- Do not ask both questions in one message.
- IMPORTANT: Do NOT ask the stretch question until 'commitment_specificity' is in completed_directives. The specificity check runs first.${lowScoreNudge
  ? `\n- IMPORTANT: We've noticed you haven't been able to meet the minimum viable commitment a couple times now. What can you absolutely guarantee you'll get done tomorrow — not what you want to do, what you WILL do no matter what? Push them for something smaller and more guaranteed.`
  : ''}${(Array.isArray(activeGoals) && activeGoals.length === 0) && !profile?.future_self
  ? `\n- If activeGoals is empty AND profile.future_self is null, after capturing the stretch commitment add one closing question: "What does committing to that say about where you're trying to get?" Then set is_session_complete:true on that same response.`
  : ''}`,
      priority: 1,
      preferred_stage: 'tomorrow',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── commitment_goal_bridge ─────────────────────────────────────────────
  const hasBothCommitments = !!sessionState.commitment_minimum && !!sessionState.commitment_stretch;
  const hasGoalsOrVision = (Array.isArray(activeGoals) && activeGoals.length > 0) || !!profile?.future_self;
  if (
    currentStage === 'tomorrow' &&
    hasBothCommitments &&
    hasGoalsOrVision &&
    !completedDirectives.includes('commitment_goal_bridge') &&
    !completedDirectives.includes('commitment_goal_why_depth')
  ) {
    const goalContext = Array.isArray(activeGoals) && activeGoals.length > 0
      ? activeGoals.map(g => {
          const latestWhy = Array.isArray(g.whys) && g.whys.length > 0
            ? g.whys[g.whys.length - 1].text
            : null;
          return `"${g.title}"${latestWhy ? ` (previously said: "${latestWhy.slice(0, 80)}")` : ' (no why captured yet)'}`;
        }).join(', ')
      : null;
    const futureContext = profile?.future_self || null;

    allDirectives.push({
      id: 'commitment_goal_bridge',
      instruction: `COMMITMENT-GOAL BRIDGE (Question 1 of 2): The user has now stated both their minimum and stretch commitment for tomorrow. Ask them why those specific tasks matter — not "is this good" or "does this connect to a goal" — ask directly: why is it important that they work on those specific things tomorrow? How do they connect to a long-term goal or vision they're working toward?

Available context to make this feel personal (do NOT recite this, use it to shape the question):
- Their active goals: ${goalContext || 'none'}
- Their stated future self vision: ${futureContext || 'not set'}

Rules:
- ONE question only. Do not validate the commitment first. Do not transition stages. Stay in tomorrow stage.
- Do NOT say "before we wrap" or any closing phrase — this is not the end, there is one more question after their answer.
- Do NOT use "before we close out tomorrow" or any variant.
- If they have a goal with a prior why, reference their own words back naturally: "You said once this was about [why] — is working on [commitment] a step toward that?"
- If they have goals but no whys yet, ask openly: "Why is it important that you work on those things tomorrow specifically — what's the bigger thing they're connected to?"
- If their future_self is set and no goals exist, frame against vision: "You said you want to be [future_self] — how does [commitment] move toward that?"
- Set directive_completed: "commitment_goal_bridge" once you have asked this question and received an answer. Do NOT set is_session_complete.`,
      priority: 1,
      preferred_stage: 'tomorrow',
      fire_next_session: false,
      energy_type: 'identity',
    });
  }

  // ── commitment_goal_why_depth ──────────────────────────────────────────
  if (
    currentStage === 'tomorrow' &&
    hasBothCommitments &&
    hasGoalsOrVision &&
    completedDirectives.includes('commitment_goal_bridge') &&
    !completedDirectives.includes('commitment_goal_why_depth')
  ) {
    // Use the first active goal as the primary context for why-depth questions.
    // The LLM instruction asks the coach to reference the most relevant goal in its response.
    const relevantGoal = Array.isArray(activeGoals) && activeGoals.length > 0 ? activeGoals[0] : null;
    const existingWhys = relevantGoal && Array.isArray(relevantGoal.whys) ? relevantGoal.whys : [];
    const latestWhy = existingWhys.length > 0 ? existingWhys[existingWhys.length - 1] : null;
    const priorWhySource = latestWhy?.source || null;
    const priorWhyText = latestWhy?.text || null;

    let whyDepthInstruction;
    if (existingWhys.length === 0) {
      whyDepthInstruction = `This goal has never had a why captured. Ask openly: "And why does [goal/vision] actually matter to you — not the surface answer, what's underneath it?"`;
    } else if (priorWhySource === 'commitment_planning') {
      whyDepthInstruction = `You asked this in a planning context before. They said: "${priorWhyText?.slice(0, 100)}". Ask if it's evolved: "Last time you said this was about [prior why] — is that still the core of it, or has something shifted?"`;
    } else if (priorWhySource === 'reflection_session') {
      whyDepthInstruction = `They articulated this during a reflection session (in the context of a specific day). They said: "${priorWhyText?.slice(0, 100)}". Ask if it still holds: "You've talked about this before — [prior why]. Does that still hold, or is there something deeper now?"`;
    } else {
      whyDepthInstruction = `They have an existing why: "${priorWhyText?.slice(0, 100)}". Push underneath it: "You said it's about [prior why] — what's underneath even that? What would be lost if you never achieved [goal]?"`;
    }

    allDirectives.push({
      id: 'commitment_goal_why_depth',
      instruction: `COMMITMENT-GOAL BRIDGE (Question 2 of 2): The user just answered why their commitment connects to a long-term goal. Now ask why that goal or vision actually matters to them. This is the second and final question of the bridge sequence.

${whyDepthInstruction}

Rules:
- ONE question. Do not validate their previous answer extensively — one brief acknowledgment at most, then the question.
- Extract their answer as goal_why_insight and set goal_id_referenced to the single most relevant goal id from the goals array (the one their commitment most clearly connects to). Use the existing goal_why_action logic (add/replace). Set goal_commitment_why: true so the write-back tags source as "commitment_planning".
- If their answer reveals a realization about the goal, also set goal_depth_insight.
- After this question is asked AND answered, set directive_completed: "commitment_goal_why_depth".
- Once directive_completed is set to "commitment_goal_why_depth", the server will set commitment_goal_bridge_done: true and route to complete.
- On the SAME response where you set directive_completed: "commitment_goal_why_depth", also set is_session_complete: true and deliver a warm, specific closing message (2-3 sentences) that ties together their commitment AND what they just said about why it matters. Use their actual words. Do NOT say "before we close out tomorrow." Do NOT announce a stage transition.`,
      priority: 1,
      preferred_stage: 'tomorrow',
      fire_next_session: false,
      energy_type: 'identity',
    });
  }

  // ── identity_missing block removed — replaced by commitment_goal_bridge / commitment_goal_why_depth directives

  // ── commitment_quality ─────────────────────────────────────────────────
  if (commitmentStats) {
    const { rate7, trajectory: traj, total7, avgScore7 } = commitmentStats;
    const commitmentStatsForInstruction =
      traj === 'declining' || (rate7 != null && rate7 < 0.5) || (avgScore7 != null && avgScore7 < 60);
    if (commitmentStatsForInstruction) {
      const ratePercent = Math.round(rate7 * 100);
      const avgScore = avgScore7 != null ? Math.round(avgScore7) : ratePercent;
      allDirectives.push({
        id: 'commitment_quality',
        instruction: `COMMITMENT QUALITY: Follow-through rate is ${ratePercent}% (${commitmentStats.kept7}/${total7} last 7 days), trajectory is ${traj}. Their fragment completion score averaged ${avgScore}/100 over the last 7 days — they're completing about ${avgScore}% of what they commit to (${commitmentStats.kept7} out of ${commitmentStats.total7} sessions followed through on the session level). When the user is forming their commitment, gently suggest they scale it back to something they can absolutely guarantee. Say something like: "Given where you're at, let's make this something you can 100% do — we can push the intensity later. What's one small thing you'll actually show up for?" Do NOT lecture. Say it once, warmly, then let them commit to what they want. When nudging for a more specific commitment, briefly frame why specificity matters: e.g. "The reason I'm pushing on this is that vague plans are easy to talk yourself out of" or "Specific commitments are what actually stick — when and how matters." One sentence, then the question.`,
        priority: 2,
        preferred_stage: 'tomorrow',
        fire_next_session: false,
        energy_type: 'planning',
      });
    }
  }

  // ── raise_the_bar ──────────────────────────────────────────────────────
  if (
    currentStage === 'tomorrow' &&
    sessionState.commitment_minimum &&
    sessionState.commitment_stretch &&
    commitmentStats?.avgScore7 >= 90
  ) {
    const hitTwoHundreds = Array.isArray(commitmentStats?.recentScores)
      && commitmentStats.recentScores.length >= 2
      && commitmentStats.recentScores.slice(-2).every((s) => s === 100);
    allDirectives.push({
      id: 'raise_the_bar',
      instruction: `RAISE THE BAR: ${hitTwoHundreds ? "They've hit 100% two days in a row. " : ''}You've been hitting everything you commit to — time to think bigger. Not just the minimum. What's the MOST you could realistically get done tomorrow if everything went well? Push them to set an ambitious stretch goal, not just a safe one.`,
      priority: 3,
      preferred_stage: 'tomorrow',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── strength_recognition ───────────────────────────────────────────────
  if (recentSessions.length >= 3) {
    const hasStrengths = Array.isArray(profile.strengths) && profile.strengths.length > 0;
    const hasGrowthAreas = Array.isArray(profile.growth_areas) && profile.growth_areas.length > 0;
    const strengthInsights = userInsights.filter(ins => ins.pattern_type === 'strength' && ins.strength_evidence);
    if (hasStrengths || hasGrowthAreas || strengthInsights.length > 0) {
      const strengthsText = hasStrengths
        ? profile.strengths.map(s => {
            if (typeof s === 'object' && s.label) return `"${s.label}": ${s.evidence || ''}`;
            return String(s);
          }).join(' | ')
        : '';
      const growthText = hasGrowthAreas
        ? profile.growth_areas.map(g => {
            if (typeof g === 'object' && g.label) return `"${g.label}": ${g.evidence || ''}`;
            return String(g);
          }).join(' | ')
        : '';
      const strengthInsightsText = strengthInsights.length > 0
        ? strengthInsights.map(ins => `"${ins.pattern_label}": ${ins.strength_evidence}`).join(' | ')
        : '';
      allDirectives.push({
        id: 'strength_recognition',
        instruction: `STRENGTH RECOGNITION: When the user names a win or something that went well, do NOT just celebrate it. Connect it to what it means for them specifically — using their goals, their whys, and the evidence you have about their patterns. You have this data:${strengthInsightsText ? `\nStrength insights (most specific — prefer these): ${strengthInsightsText}` : ''}${strengthsText ? `\nTracked strengths: ${strengthsText}` : ''}${growthText ? `\nGrowth in progress: ${growthText}` : ''}\nWhen a win connects to a tracked strength or growth area — name the specific evidence first, then connect it to their goal or why. Prefer strength_insights evidence over profile strengths since it's more specific and recent. E.g. if they mention finishing something under pressure and you have evidence they've done this before, say: "You've done this [specific number] times now — [specific dates/events from evidence]. That's the thing that actually moves [their specific goal]." Pull from their actual whys array and goal context to explain why it matters. The explanation must come from their data, not from a coaching script. If a win doesn't connect to anything tracked, just acknowledge it briefly and move on — no forced meaning.`,
        priority: 2,
        preferred_stage: 'wins',
        fire_next_session: false,
        energy_type: 'planning',
      });
    }
  }

  // ── wins_goal_callback ─────────────────────────────────────────────────
  const fragmentsWithGoalLinks = (enrichedYesterdayFragments || yesterdayFragments || []).filter(f => f.goal_id && f.goal_why_context);
  if (
    currentStage === 'wins' &&
    fragmentsWithGoalLinks.length > 0 &&
    !completedDirectives.includes('wins_goal_callback')
  ) {
    const fragmentContextStr = fragmentsWithGoalLinks.map(f =>
      `"${sanitizeForPrompt(f.commitment_text, 120)}" → goal: "${sanitizeForPrompt(f.goal_title, 80) || 'unknown'}", why they said: "${sanitizeForPrompt(f.goal_why_context, 100)}"`
    ).join(' | ');
    allDirectives.push({
      id: 'wins_goal_callback',
      instruction: `WINS-GOAL CALLBACK: Yesterday's commitments were linked to goals with reasons the user stated. Context: ${fragmentContextStr}. Instructions:
- If the user mentions a win that sounds like it connects to one of these goals or commitment topics, surface the connection: "That's [goal title] — you said this was about [their why]. When you actually got it done today, did that hold true — or did it feel like something else entirely?"
- Do NOT force this if the user's win doesn't connect. Only trigger when the topic naturally overlaps.
- If you surface it, set goal_id_referenced to the matching goal's id.
- ONE use only — pick the most relevant fragment/win overlap. Do not stack multiple references.
- After using this, set directive_completed: "wins_goal_callback".`,
      priority: 2,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'momentum',
    });
  }

  // ── wins_why_matters ────────────────────────────────────────────────────
  const capturedWinTexts = Array.isArray(sessionState.wins)
    ? sessionState.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean)
    : [];
  const hasGoalsWithWhys = activeGoals.some(g => Array.isArray(g.whys) && g.whys.length > 0);
  if (
    currentStage === 'wins' &&
    sessionState.wins_asked_for_more === true &&
    capturedWinTexts.length > 0 &&
    fragmentsWithGoalLinks.length === 0 &&  // only fire when wins_goal_callback won't fire
    hasGoalsWithWhys &&
    !completedDirectives.includes('wins_why_matters')
  ) {
    allDirectives.push({
      id: 'wins_why_matters',
      instruction: `WINS WHY MATTERS: The user has shared wins today. You have their goals and whys as context. Do NOT ask "why did this matter?" generically. Instead: look at what they said went well today and their active goals. If a win connects to a goal even loosely — name the connection and ask why completing that specific thing matters to them in the context of where they're trying to get. Use their actual goal title and their stated why as the premise of the question. E.g. "You said [goal] matters because [their why] — does getting [today's win] done feel like it's actually moving that?" One question only. If no win connects to any goal, skip this directive and set directive_completed: "wins_why_matters" immediately.`,
      priority: 2,
      preferred_stage: 'wins',
      fire_next_session: false,
      energy_type: 'depth',
    });
  }

  // ── wins_why_probe ───────────────────────────────────────────────────────
  const winsWhyProbesDone = completedDirectives.filter(id => id.startsWith('wins_why_probe_')).length;
  const canRunWinsWhyProbe =
    currentStage === 'wins' &&
    sessionState.wins_asked_for_more === true &&
    Array.isArray(sessionState.wins) && sessionState.wins.length > 0 &&
    winsWhyProbesDone < MAX_WHY_PROBES_PER_STAGE &&
    !completedDirectives.includes(`wins_why_probe_${winsWhyProbesDone + 1}`);

  if (canRunWinsWhyProbe) {
    const rankedGoals = rankGoalsForWhyProbe(
      activeGoals,
      sessionState.wins,
      sessionState.misses
    );
    const probeGoals = rankedGoals.slice(0, MAX_WHY_PROBES_PER_STAGE);

    if (probeGoals.length > 0) {
      const probeIndex = winsWhyProbesDone; // 0 to MAX_WHY_PROBES_PER_STAGE-1
      const targetGoal = probeGoals[probeIndex];
      if (targetGoal) {
        const safeTitle = sanitizeForPrompt(targetGoal.title, 80);
        const safeWhy = sanitizeForPrompt(
          Array.isArray(targetGoal.whys) && targetGoal.whys.length > 0
            ? targetGoal.whys[targetGoal.whys.length - 1]?.text
            : '',
          120
        );
        const safeVision = sanitizeForPrompt(targetGoal.vision_snapshot || '', 120);
        const probeId = `wins_why_probe_${probeIndex + 1}`;

        allDirectives.push({
          id: probeId,
          instruction: `WINS WHY PROBE (${probeIndex + 1} of up to ${MAX_WHY_PROBES_PER_STAGE}): Ask ONE why-probe question about the goal "${safeTitle}".${safeVision ? ` Vision context: "${safeVision}".` : ''}${safeWhy ? ` Stated why: "${safeWhy}".` : ''} 
Select the angle that fits the richest available data (see GOAL WHY-PROBE QUESTIONS in your instructions). Angles used so far this session are tracked — do not repeat an angle.
Available angles: (1) Action→Goal progress, (2) Action→Long-term self${safeVision ? ' [vision available]' : ''}${safeWhy ? ' [why available]' : ''}, (3) How they actually feel.
Ask one natural, specific question. Do NOT prefix with "I want to ask you something" or any meta-framing.
After the user responds, evaluate: if they revealed meaningful motivation → set goal_why_probe_insight: {goal_id: "${targetGoal.id}", text: <their words>, action: "replace"|"add"|null, replace_index: <number or null>}. Otherwise set goal_why_probe_insight: null.
Set directive_completed: "${probeId}" when done.`,
          priority: 2,
          preferred_stage: 'wins',
          fire_next_session: false,
          energy_type: 'depth',
        });
      }
    }
  }
  if (userInsights.length > 0 && messageCount >= 2 && (userInsights[0].sessions_synthesized_from || 0) >= 2) {
    const topInsight = userInsights[0];
    allDirectives.push({
      id: 'pattern_awareness',
      instruction: `PATTERN AWARENESS: The user's most recurring pattern is "${topInsight.pattern_label}" (${topInsight.sessions_synthesized_from || 0}x). If they say or do something that looks like this pattern — even obliquely — ask a question that helps them SEE it, not name it for them. Never say "I notice you keep doing X" or "this sounds like your ${topInsight.pattern_label} pattern". Instead, ask something like: "What's making it hard to just ship it as-is?" or "You said you'd do this yesterday — what happened between then and now?" The goal is to surface the pattern through their own answer, not your observation. Use naturally. Once per session max. Do NOT interrupt a good moment to force it in. When you name it, briefly frame why noticing patterns matters: e.g. "I keep seeing this come up — and I think it's worth naming because patterns don't change until you see them" or "This is something I've noticed across a few sessions." One sentence, then surface the pattern.`,
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: 'I\'ve been thinking about something that\'s shown up a few times — I want to check in on whether you\'re noticing it too.',
      energy_type: 'reflective',
    });
  }

  // ── recurring_miss ─────────────────────────────────────────────────────
  if (recentSessions.length >= 2) {
    const todayCommitment = sessionState.yesterday_commitment || yesterdayCommitment;
    if (todayCommitment) {
      const commitmentPrefix = todayCommitment.toLowerCase().slice(0, 20);
      const missedStreak = recentSessions.filter(s =>
        s.tomorrow_commitment &&
        s.tomorrow_commitment.toLowerCase().includes(commitmentPrefix)
      ).length;
      if (missedStreak >= 2) {
        allDirectives.push({
          id: 'recurring_miss',
          instruction: `RECURRING MISS: Name the pattern to the user transparently before pivoting — e.g. "I want to be honest with you — this is the ${missedStreak}th time we've talked about ${todayCommitment} and it hasn't happened. I'm not going to ask what's holding you back again." Then pivot. Do NOT re-ask "what's holding you back?" — they've already answered that. Instead, name the pattern directly and warmly: "You've said you'd do this ${missedStreak} days in a row. Something keeps getting in the way — what's actually going on?" This is a pattern interrupt. Be direct but warm. Do NOT soften it into another generic depth probe.`,
          priority: 1,
          preferred_stage: 'commitment_checkin',
          fire_next_session: false,
          energy_type: 'planning',
        });
      }
    }
  }

  // ── stage_hint ─────────────────────────────────────────────────────────
  if (suggestedNextStage && !isMemoryMode) {
    // Determine if the user's last message signals they're done with wins
    const lastUserMsg = Array.isArray(history) && history.length > 0
      ? [...history].reverse().find(m => m.role === 'user')
      : null;
    const lastUserText = (lastUserMsg?.content || '').trim().toLowerCase();
    const doneWithWinsPatterns = [
      /^nah\b/,
      /^nope\b/,
      /^no\b/,
      /\bthat'?s it\b/,
      /\bnothing else\b/,
      /\bnothing\b/,
      /\bi think that'?s it\b/,
      /\bdone\b/,
      /\bnot really\b/,
    ];
    const userSignaledDone = lastUserText.length < 15
      || doneWithWinsPatterns.some((pattern) => pattern.test(lastUserText));

    const isWinsToHonest = sessionState.current_stage === 'wins' && suggestedNextStage === 'honest';
    const stageHintInstruction = (isWinsToHonest && userSignaledDone)
      ? 'STAGE HINT: You MUST set stage_advance:true, new_stage:"honest" on this response. Do not wait — the user has signaled they are done with wins. Transition with a soft pivot phrase (e.g. "Okay — I want to shift for a second.") and ask the honest question. Never announce the stage name.'
      : `STAGE HINT: Ready to move to "${suggestedNextStage}". Transition naturally if conversation supports it — use a soft bridging phrase that signals the shift without announcing it. E.g. for wins→honest: "Okay — I want to shift for a second." For honest→tomorrow: "Alright, I've got a good picture of today. Let's talk about tomorrow." For tomorrow→complete: Do not announce a stage shift. Name the arc — what they committed to and the why behind it — in one sentence. Then set is_session_complete:true and deliver a warm specific closing message using their actual words. Never announce the stage name. Set stage_advance:true, new_stage:"${suggestedNextStage}".`;

    allDirectives.push({
      id: 'stage_hint',
      instruction: stageHintInstruction,
      priority: 2,
      preferred_stage: 'any',
      fire_next_session: false,
      energy_type: 'planning',
    });
  }

  // ── Filter: remove already-completed and already-queued directives ─────
  const filtered = allDirectives.filter(d => {
    if (completedDirectives.includes(d.id)) return false;
    if (currentDirectiveQueue.some(q => q.id === d.id)) return false;
    return true;
  });

  // ── Sort: priority ascending, then stage match ────────────────────────
  filtered.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aMatch = a.preferred_stage === currentStage || a.preferred_stage === 'any' ? 0 : 1;
    const bMatch = b.preferred_stage === currentStage || b.preferred_stage === 'any' ? 0 : 1;
    return aMatch - bMatch;
  });

  return filtered;
}

/**
 * Picks the next directive to dispatch this message from the combined directive queue.
 * Prefers highest-priority, stage-matching directives.
 * Uses intentEmotionalState as a tiebreaker when multiple candidates tie at the same level.
 */
function dispatchNextDirective(directiveQueue, currentStage, intentEmotionalState, messageCount = 0, sessionExercisesRun = []) {
  if (!directiveQueue || directiveQueue.length === 0) return null;

  const EMOTIONAL_ENERGY_PREFERENCE = {
    reflective: ['depth', 'reflective'],
    stuck:      ['depth', 'reflective'],
    proud:      ['momentum', 'identity'],
    celebrate:  ['momentum', 'identity'],
    flat:       ['depth', 'reflective'],
    low:        ['depth', 'reflective'],
    motivated:  ['planning'],
  };

  const preferredEnergies = EMOTIONAL_ENERGY_PREFERENCE[intentEmotionalState] || [];

  function energyScore(directive) {
    if (preferredEnergies.length === 0) return 999;
    const idx = preferredEnergies.indexOf(directive.energy_type);
    return idx === -1 ? 999 : idx;
  }

  function pickBest(candidates) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    if (currentStage === 'close') {
      // Sort by close_order ascending; undefined close_order sorts last
      const sorted = [...candidates].sort((a, b) => {
        const ao = a.close_order != null ? a.close_order : 9999;
        const bo = b.close_order != null ? b.close_order : 9999;
        return ao - bo;
      });
      return sorted[0];
    }
    // Tiebreak by energy preference, then original order
    const sorted = [...candidates].sort((a, b) => energyScore(a) - energyScore(b));
    return sorted[0];
  }

  // Priority 1, stage match
  const p1Stage = directiveQueue.filter(
    d => d.priority === 1 && (d.preferred_stage === currentStage || d.preferred_stage === 'any')
  );
  if (p1Stage.length > 0) return pickBest(p1Stage);

  // Priority 1, any stage
  const p1Any = directiveQueue.filter(d => d.priority === 1);
  if (p1Any.length > 0) return pickBest(p1Any);

  const shouldPromoteExerciseDirective = (
    (currentStage === 'honest' || currentStage === 'close')
    && messageCount >= 4
    && Array.isArray(sessionExercisesRun)
    && sessionExercisesRun.length === 0
  );
  if (shouldPromoteExerciseDirective) {
    const firstQueuedExerciseDirective = directiveQueue.find(
      (directive) =>
        (directive.id === 'run_exercise' || directive.id === 'insight_triggered_exercise')
        && (directive.preferred_stage === currentStage || directive.preferred_stage === 'any')
    );
    if (firstQueuedExerciseDirective) {
      return { ...firstQueuedExerciseDirective, effective_priority: 0.5 };
    }
  }

  const p15Stage = directiveQueue.filter(
    d => d.priority > 1 && d.priority < 2 && (d.preferred_stage === currentStage || d.preferred_stage === 'any')
  );
  if (p15Stage.length > 0) return pickBest(p15Stage);

  const p15Any = directiveQueue.filter(d => d.priority > 1 && d.priority < 2);
  if (p15Any.length > 0) return pickBest(p15Any);

  // Priority 2, stage match
  const p2Stage = directiveQueue.filter(
    d => d.priority === 2 && (d.preferred_stage === currentStage || d.preferred_stage === 'any')
  );
  if (p2Stage.length > 0) return pickBest(p2Stage);

  // Priority 2, any stage
  const p2Any = directiveQueue.filter(d => d.priority === 2);
  if (p2Any.length > 0) return pickBest(p2Any);

  // Priority 3+ / fallback
  return pickBest(directiveQueue);
}

// ── Session context assembly ──────────────────────────────────────────────────

/**
 * Builds the structured context object that is JSON-serialised into the GPT-4o
 * user-role message.  Accepts all pre-loaded/pre-computed session data and
 * derives any remaining values internally so the handler stays clean.
 */
function buildSessionContext({
  profile,
  goalsContext,
  userInsights,
  sessionState,
  recentSessions,
  commitmentStats,
  followUpQueue,
  growthMarkers,
  suggestedPractice,
  isFirstTimeExercise,
  exercisesExplained,
  intentData,
  preSessionState,
  yesterdayCommitment,
  yesterdayMinimum,
  yesterdayStretch,
  relevantMemories,
  clientDate,
  sameDayCommitment,
  activeGoals,
  quietGoals,
  goalsNeedWhyBuilding,
  messageCount,
  consecutiveExcuses,
  effectiveConsecutiveExcuses,
  suggestedNextStage,
  precomputedCommitmentScore,
  streak,
  daysSinceLastSession,
  activeDirective,
  directiveQueue,
  completedDirectives,
  progressEvents,   // <-- progress event threshold crossings
}) {
  // ── Derive internal values ─────────────────────────────────────────────
  const sessionExercisesRun = Array.isArray(sessionState.exercises_run) ? sessionState.exercises_run : [];
  const mergedChecklist = { ...(sessionState.checklist || {}), ...(intentData?.checklist_content || {}) };
  const tomorrowFilled = !!sessionState.tomorrow_commitment;
  const hasMissInSession = Array.isArray(sessionState.misses) && sessionState.misses.length > 0;
  const honestMissing = !mergedChecklist.honest && !hasMissInSession;
  const bridgeDone = sessionState.commitment_goal_bridge_done === true;
  const sessionReadyToClose = tomorrowFilled && !!sessionState.commitment_minimum && bridgeDone;
  const EMERGENCY_CLOSE_THRESHOLD = 20;
  const forceClose = messageCount >= EMERGENCY_CLOSE_THRESHOLD && tomorrowFilled;
  const depthProbeNeeded = !!(intentData?.depth_opportunity && (sessionState?.depth_opportunity_count ?? 0) >= 2 && shouldAllowDepthProbe(sessionState, messageCount));
  const isMemoryMode = ['question', 'advice_request', 'memory_query'].includes(intentData?.intent);
  const goalMissingWhy = goalsNeedWhyBuilding.find(g => !Array.isArray(g.whys) || g.whys.length === 0) ?? null;

  const recentSessionsText = recentSessions.slice(0, 3).map((s) => {
    const blockers = Array.isArray(s.blocker_tags) ? s.blocker_tags.join(', ') : '';
    if (s.summary) {
      let line = `${s.date}: ${s.summary}`;
      if (blockers) line += ` blockers=[${blockers}]`;
      return line;
    }
    const wins = Array.isArray(s.wins) ? s.wins.map((w) => (typeof w === 'string' ? w : w.text)).filter(Boolean) : [];
    let line = `${s.date}: wins=[${wins.slice(0, 2).join(', ')}] commitment="${s.tomorrow_commitment || ''}"`;
    if (blockers) line += ` blockers=[${blockers}]`;
    return line;
  }).join(' | ') || 'none';

  const contextData = {
    profile: {
      name: profile.display_name,
      identity: profile.identity_statement,
      goal: profile.big_goal,
      why: profile.why,
      future_self: profile.future_self,
      life_areas: Array.isArray(profile.life_areas) ? profile.life_areas.join(', ') : '',
      values: Array.isArray(profile.values) && profile.values.length > 0 ? profile.values.join(', ') : undefined,
      short_term_state: profile.short_term_state || undefined,
      long_term_patterns: Array.isArray(profile.long_term_patterns) && profile.long_term_patterns.length > 0 ? profile.long_term_patterns : undefined,
      growth_areas: Array.isArray(profile.growth_areas) && profile.growth_areas.length > 0 ? profile.growth_areas : undefined,
      strengths: Array.isArray(profile.strengths) && profile.strengths.length > 0 ? profile.strengths : undefined,
    },
    goals: goalsContext.length > 0 ? goalsContext : 'none',
    quiet_goals: quietGoals.length > 0 ? quietGoals : undefined,
    goals_need_why_building: goalsNeedWhyBuilding.length > 0
      ? goalsNeedWhyBuilding.map((g) => {
          const hasWhys = Array.isArray(g.whys) && g.whys.length > 0;
          return {
            goal_id: g.id,
            title: g.title,
            category: g.category || null,
            whys: hasWhys ? g.whys : [],
            has_whys: hasWhys,
            motivation_signal: g.motivation_signal,
            commitment_rate: g.commitment_stats?.rate_last_14 ?? null,
            commitment_rate_last_7: g.commitment_stats?.rate_last_7 ?? null,
          };
        })
      : undefined,
    yesterday_commitment: yesterdayCommitment || 'none',
    yesterday_commitment_minimum: yesterdayMinimum || null,
    yesterday_commitment_stretch: yesterdayStretch || null,
    same_day_commitment: sameDayCommitment ? { commitment: sameDayCommitment.commitment, made_at: sameDayCommitment.made_at } : undefined,
    // user_insights takes priority — rich synthesised records with narrative/trigger/quote/foothold/practices
    user_insights: userInsights.length > 0
      ? userInsights.map((ins) => ({
          label: ins.pattern_label,
          type: ins.pattern_type,
          narrative: ins.pattern_narrative,
          trigger: ins.trigger_context,
          user_quote: ins.user_quote,
          foothold: ins.foothold,
          practices: ins.unlocked_practices,
          confidence: ins.confidence_score,
          first_seen_date: ins.first_seen_date || null,
          last_seen_date: ins.last_seen_date || null,
        }))
      : undefined,
    strength_insights: (() => {
      const si = userInsights.filter(ins => ins.pattern_type === 'strength' && ins.strength_evidence)
        .map(ins => ({
          label: ins.pattern_label,
          evidence: ins.strength_evidence,
          narrative: ins.pattern_narrative,
          user_quote: ins.user_quote,
        }));
      return si.length > 0 ? si : undefined;
    })(),
    recent_sessions: recentSessionsText,
    relevant_memories: relevantMemories.length > 0
      ? relevantMemories.map((m) => ({ date: m.date, summary: m.summary, similarity: m.similarity }))
      : undefined,
    commitment_stats: commitmentStats
      ? {
          rate_last_7: Math.round(commitmentStats.rate7 * 100) / 100,
          trajectory: commitmentStats.trajectory,
          kept: commitmentStats.kept7,
          total: commitmentStats.total7,
          avg_score_last_7: commitmentStats.avgScore7 != null
            ? Math.round(commitmentStats.avgScore7 * 100) / 100
            : null,
        }
      : undefined,
    progress_events: Array.isArray(progressEvents) && progressEvents.length > 0
      ? progressEvents.map((e) => ({
          id: e.id,
          type: e.event_type,
          display_text: e.payload?.display_text,
          created_at: e.created_at,
        }))
      : undefined,
    session: {
      stage: sessionState.current_stage || 'commitment_checkin',
      stage_order_swapped: sessionState.stage_order_swapped === true,
      checklist: mergedChecklist,
      tomorrow_commitment: sessionState.tomorrow_commitment || null,
      exercises_run: sessionExercisesRun,
      consecutive_excuses: consecutiveExcuses,
      message_count: messageCount,
      wins_asked_for_more: sessionState.wins_asked_for_more === true,
      honest_depth: sessionState.honest_depth === true,
      commitment_checkin_done: sessionState.commitment_checkin_done === true,
      commitment_goal_bridge_done: sessionState.commitment_goal_bridge_done === true,
      yesterday_commitment_in_state: !!(sessionState.yesterday_commitment || yesterdayCommitment),
      session_wins_captured: Array.isArray(sessionState.wins)
        ? sessionState.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean)
        : [],
      session_misses_captured: Array.isArray(sessionState.misses)
        ? sessionState.misses.map(m => typeof m === 'string' ? m : m?.text).filter(Boolean)
        : [],
      session_blockers_captured: sessionState.blocker_tags || [],
      depth_insight_captured: sessionState.depth_insight || null,
      depth_probe_count: sessionState.depth_probe_count || 0,
      last_depth_probe_message_index: sessionState.last_depth_probe_message_index ?? null,
      insight_exercises_triggered: Array.isArray(sessionState.insight_exercises_triggered) ? sessionState.insight_exercises_triggered : [],
      insight_exercise_skipped: sessionState.insight_exercise_skipped === true,
    },
    intent: {
      type: intentData.intent,
      energy: intentData.energy_level,
      accountability: intentData.accountability_signal,
      emotion: intentData.emotional_state,
      depth_opportunity: intentData.depth_opportunity || false,
    },
    follow_up_due: followUpQueue ? { context: followUpQueue.context, question: followUpQueue.question } : null,
    pending_follow_up: followUpQueue
      ? { id: followUpQueue.id, context: followUpQueue.context, question: followUpQueue.question }
      : undefined,
    growth_marker_due: growthMarkers ? { theme: growthMarkers.theme, msg: growthMarkers.check_in_message } : null,
    exercise: { suggested: suggestedPractice, first_time: isFirstTimeExercise, explained: exercisesExplained },
    stage_hint: suggestedNextStage,
    ready_to_close: sessionReadyToClose,
    streak,
    days_since_last_session: daysSinceLastSession,
    precomputed_commitment_score: precomputedCommitmentScore,
    pre_session_state: preSessionState || undefined,
      instructions: [
        // ── Active directive — one queued coaching action dispatched this message ─
        activeDirective ? activeDirective.instruction : null,
        sessionState.stage_order_swapped === true
          ? 'STAGE ORDER FOR THIS SESSION: commitment_checkin → honest → wins → tomorrow → close. Keep this order unless safety requires otherwise.'
          : null,
        // ── Guard rails — always permanent context ────────────────────────────
        forceClose
          ? 'EMERGENCY CLOSE: Session has gone unusually long. Something likely went wrong with normal stage progression. Wrap up NOW with a warm closing message. Set is_session_complete:true. No more questions.'
          : sessionReadyToClose
          ? `READY TO CLOSE: The session is done. Set is_session_complete:true on this response. Do NOT ask any new questions — not even one. Write 2-3 sentences only:
1. Name what they committed to, using their exact words from the commitment (not a paraphrase).
2. Connect it to what they said about why it matters — pull from their actual words in this conversation.
3. One short identity statement — use language they used about themselves, not coaching-speak like "you're becoming someone who..." or "that's a big shift."
Do NOT use the words or phrases: "proud", "powerful", "shift", "journey", "lean into", "embrace", "growth mindset".
Do NOT ask a follow-up question. Do NOT invite reflection. Just close.`
          : null,
      // ── Base rules — always ───────────────────────────────────────────────
      'Use their actual words — never be generic.',
      '2-3 sentences max.',
      'NEVER drill a topic already answered.',
    ].filter(Boolean),
    active_directive: activeDirective ? { id: activeDirective.id, priority: activeDirective.priority } : null,
    directive_queue_size: Array.isArray(directiveQueue) ? directiveQueue.length : 0,
    completed_directives: Array.isArray(completedDirectives) ? completedDirectives : [],
  };

  return { role: 'user', content: JSON.stringify(contextData) };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let authenticatedUserId;
  if (process.env.SIM_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    // Simulation bypass: skip JWT auth and use user_id from body directly.
    // Only active when SIM_MODE=true (set in .env.simulation.local) and not in production.
    const simUserId = req.body?.user_id;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!simUserId || !uuidPattern.test(simUserId)) {
      return res.status(400).json({ error: 'SIM_MODE requires a valid UUID user_id in body' });
    }
    authenticatedUserId = simUserId;
  } else {
    try {
      authenticatedUserId = await getAuthenticatedUserId(req);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  try {
    const {
      user_id, session_id,
      session_state = {}, history = [],
      user_message, context = {},
      intent_data: clientIntentData = null,
    } = req.body;
    const originalUserMessage = user_message;

    // Extract client-supplied local date and timezone offset (sent by the browser)
    // client_local_date: YYYY-MM-DD string in the user's local time
    // client_tz_offset: minutes WEST of UTC (from new Date().getTimezoneOffset(), e.g. EST = 300)
    const client_local_date = context.client_local_date || null;
    const client_tz_offset = context.client_tz_offset != null ? context.client_tz_offset : null;
    const contextCommitmentRate7Raw = Number(context.commitment_rate_7);
    const contextCommitmentRate7 = Number.isFinite(contextCommitmentRate7Raw) ? contextCommitmentRate7Raw : null;
    const contextCommitmentTrajectory = typeof context.commitment_trajectory === 'string' ? context.commitment_trajectory : null;
    const contextAvgCommitmentScoreRaw = Number(context.avg_commitment_score);
    const contextAvgCommitmentScore = Number.isFinite(contextAvgCommitmentScoreRaw) ? contextAvgCommitmentScoreRaw : null;
    const contextScoreTrajectory = typeof context.score_trajectory === 'string' ? context.score_trajectory : null;

    if (!authenticatedUserId || !originalUserMessage) {
      return res.status(400).json({ error: 'user_id and user_message are required' });
    }

    const isInit = originalUserMessage === '__INIT__';
    const isChecklistSubmission = originalUserMessage === '__CHECKLIST_SUBMITTED__';
    const isExerciseSkipSignal = originalUserMessage === '__EXERCISE_SKIP__' || context?.exercise_action === 'skip';
    let displayMessage = originalUserMessage;
    let precomputedScore = null;
    if (isChecklistSubmission) {
      const checklist = Array.isArray(context?.checklist_result) ? context.checklist_result : [];
      const keptCount = checklist.filter((i) => i?.kept === true).length;
      const total = checklist.length;
      displayMessage = `I completed ${keptCount} out of ${total} things I committed to.`;
    } else if (isExerciseSkipSignal) {
      displayMessage = 'Keep going.';
    }

    // If checklist result submitted, evaluate fragments and inject score
    if (
      context.checklist_result &&
      Array.isArray(context.checklist_result) &&
      context.checklist_result.length > 0 &&
      client_local_date
    ) {
      try {
        const yesterday = localDate(-1, client_local_date);
        const now = new Date().toISOString();
        for (const item of context.checklist_result) {
          if (!item?.id || typeof item?.kept !== 'boolean') continue;
          supabase
            .from('goal_commitment_log')
            .update({ kept: item.kept, evaluated_at: now })
            .eq('id', item.id)
            .eq('user_id', authenticatedUserId)
            .eq('date', yesterday)
            .then(() => {})
            .catch(() => {});
        }
        const kept = context.checklist_result.filter((i) => i.kept).length;
        const total = context.checklist_result.length;
        precomputedScore = total > 0 ? Math.round((kept / total) * 100) : 0;
      } catch (_e) {}
    }
    let checklistResultContextInstruction = '';
    if (Array.isArray(context?.checklist_result) && context.checklist_result.length > 0) {
      const kept = context.checklist_result.filter((item) => item.kept).length;
      const total = context.checklist_result.length;
      checklistResultContextInstruction = `\n\nCHECKLIST RESULT: The user submitted yesterday's checklist and marked ${kept}/${total} complete. Acknowledge this directly and naturally before moving forward.`;
    }

    // ── 1. Classify intent ────────────────────────────────────────────────
    let intentData = clientIntentData;
    if (!intentData && !isInit) {
      intentData = await classifyIntent(displayMessage, session_state);
    }
    if (!intentData) {
      intentData = { ...DEFAULT_CLASSIFICATION };
    }

    // ── 1b. Evaluate goal commitments before loading stats ────────────────
    if (client_local_date) {
      runGoalCommitmentEvaluation(authenticatedUserId, client_local_date);
    }

    // ── 2. Load context in parallel ───────────────────────────────────────
    const currentSignals = [intentData?.intent, intentData?.emotional_state, intentData?.accountability_signal].filter(Boolean);

    const [loadedFollowUpQueue, growthMarkers, recentSessions, yesterdayCommitment, yesterdayCommitmentDetails, yesterdayFragments, userProfile, activeGoalsRaw, commitmentStats, todayEarlyCommitment, goalCommitmentStats, userInsights, progressEvents] =
      await Promise.all([
        loadFollowUpQueue(authenticatedUserId, currentSignals, client_local_date),
        loadGrowthMarkers(authenticatedUserId, client_local_date),
        loadRecentSessionsSummary(authenticatedUserId),
        loadYesterdayCommitment(authenticatedUserId, client_local_date),
        loadYesterdayCommitmentDetails(authenticatedUserId, client_local_date),
        loadYesterdayFragments(authenticatedUserId, client_local_date),
        loadUserProfile(authenticatedUserId),
        loadActiveGoals(authenticatedUserId),
        loadCommitmentStats(authenticatedUserId, client_local_date),
        loadTodayEarlyCommitment(authenticatedUserId, client_local_date),
        loadGoalCommitmentStats(authenticatedUserId, client_local_date),
        loadUserInsights(authenticatedUserId),
        loadProgressEvents(authenticatedUserId),
      ]);

    // Filter out stale identity_missing follow-ups that were queued with the generic placeholder text
    const DEPRECATED_IDENTITY_FOLLOWUP_QUESTION = "I want to end on something important — what does how you showed up last time say about who you're becoming?";
    // Normalize punctuation/whitespace so we can reliably match historical variants of the same text.
    const normalizeFollowUpQuestion = (text = '') => text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
    const deprecatedIdentityFollowUpQuestion = normalizeFollowUpQuestion(DEPRECATED_IDENTITY_FOLLOWUP_QUESTION);
    let followUpQueue = (loadedFollowUpQueue || []).filter(
      f => normalizeFollowUpQuestion(f.question) !== deprecatedIdentityFollowUpQuestion
    );
    const sessionInitFollowUpQueue = yesterdayCommitment
      ? followUpQueue.filter((item) => item.type !== 'commitment_followup')
      : followUpQueue;

    // Attach motivation signal to each goal
    const activeGoals = activeGoalsRaw.map((g) => {
      const gStats = goalCommitmentStats.find((s) => s.goal_id === g.id) || null;
      return {
        ...g,
        motivation_signal: computeGoalMotivationSignal(gStats, g),
        commitment_stats: gStats || null,
        _goalStats: gStats,
      };
    });

    // Enrich yesterday fragments with goal title and why context (no extra DB query — use already-loaded goals)
    const enrichedYesterdayFragments = (yesterdayFragments || []).map(f => {
      const linkedGoal = activeGoals.find(g => g.id === f.goal_id);
      return {
        ...f,
        goal_title: linkedGoal?.title || null,
        // Prefer synthesized summary; fall back to most recent why text
        goal_why_context: linkedGoal?.why_summary
          || (Array.isArray(linkedGoal?.whys) && linkedGoal.whys.length > 0
            ? linkedGoal.whys[linkedGoal.whys.length - 1].text
            : null),
      };
    });
    const resolvedCommitmentRate7 = contextCommitmentRate7 !== null
      ? contextCommitmentRate7
      : (commitmentStats?.rate7 != null ? Math.round(commitmentStats.rate7 * 100) : null);
    const resolvedCommitmentTrajectory = contextCommitmentTrajectory ?? commitmentStats?.trajectory ?? null;
    const resolvedAvgCommitmentScore = contextAvgCommitmentScore ?? commitmentStats?.avgScore7 ?? null;
    const resolvedScoreTrajectory = contextScoreTrajectory ?? commitmentStats?.scoreTrajectory ?? null;

    // ── Tag prior-state flags for progress event dedup ───────────────────────
    // Run both tagging passes concurrently to avoid up to N sequential DB
    // roundtrips (one per insight + one per goal) blocking the response path.
    await Promise.all([
      // Tag user insights: _had_foothold_previously = true if a foothold_unlocked
      // event already exists for this insight id (prevents duplicate event writes).
      ...(Array.isArray(userInsights) ? userInsights.map(async (insight) => {
        if (insight.foothold) {
          const { data: existingFootholdEvent } = await supabase
            .from('user_progress_events')
            .select('id')
            .eq('user_id', authenticatedUserId)
            .eq('event_type', 'foothold_unlocked')
            .contains('payload', { insight_id: insight.id })
            .maybeSingle();
          insight._had_foothold_previously = !!existingFootholdEvent;
        } else {
          insight._had_foothold_previously = true; // no foothold = nothing to fire
        }
      }) : []),
      // Tag goals: _had_depth_insight_previously = true if a first_depth_insight
      // event already exists for this goal id (prevents duplicate event writes).
      ...(Array.isArray(activeGoals) ? activeGoals.map(async (goal) => {
        if (goal.id) {
          const { data: existingDepthEvent } = await supabase
            .from('user_progress_events')
            .select('id')
            .eq('user_id', authenticatedUserId)
            .eq('event_type', 'first_depth_insight')
            .contains('payload', { goal_id: goal.id })
            .maybeSingle();
          goal._had_depth_insight_previously = !!existingDepthEvent;
        } else {
          goal._had_depth_insight_previously = true;
        }
      }) : []),
    ]);

    // ── 2b. Pre-session state (init only, zero extra DB queries) ─────────
    const preSessionState = isInit
      ? computePreSessionState(client_local_date, { recentSessions, followUpQueue: sessionInitFollowUpQueue, growthMarkers, userInsights })
      : null;

    // ── 3. Merge profile ──────────────────────────────────────────────────
    const profile = {
      display_name: context.display_name || userProfile?.display_name || userProfile?.full_name || null,
      identity_statement: context.identity_statement || userProfile?.identity_statement || null,
      big_goal: context.big_goal || userProfile?.big_goal || null,
      why: context.why || userProfile?.why || null,
      future_self: context.future_self || userProfile?.future_self || null,
      life_areas: context.life_areas || userProfile?.life_areas || [],
      blockers: context.blockers || userProfile?.blockers || [],
      values: userProfile?.values || [],
      short_term_state: userProfile?.short_term_state || null,
      long_term_patterns: userProfile?.long_term_patterns || [],
      growth_areas: userProfile?.growth_areas || [],
      strengths: userProfile?.strengths || [],
      consecutive_excuse_sessions: userProfile?.consecutive_excuse_sessions || 0,
      last_session_completed_at: userProfile?.last_session_completed_at || null,
    };
    const historicalExplainedExercises = new Set(
      (recentSessions || [])
        .flatMap((session) => (Array.isArray(session.exercises_run) ? session.exercises_run : []))
        .filter(Boolean)
    );

    // ── 3b. Days since last session ───────────────────────────────────────
    let daysSinceLastSession = null;
    if (profile.last_session_completed_at && client_local_date) {
      const [lastYear, lastMonth, lastDay] = profile.last_session_completed_at.split('-').map(Number);
      const [todayYear, todayMonth, todayDay] = client_local_date.split('-').map(Number);
      const lastMs = new Date(lastYear, lastMonth - 1, lastDay).getTime();
      const todayMs = new Date(todayYear, todayMonth - 1, todayDay).getTime();
      daysSinceLastSession = Math.round((todayMs - lastMs) / (1000 * 60 * 60 * 24));
    }

    // ── 4. Consecutive excuses ────────────────────────────────────────────────
    let consecutiveExcuses = session_state.consecutive_excuses || 0;
    const crossSessionExcuses = profile?.consecutive_excuse_sessions || 0;

    // Seed from cross-session count at session start; use in-session count once tracking begins
    const effectiveConsecutiveExcuses = session_state.consecutive_excuses > 0 ? session_state.consecutive_excuses : crossSessionExcuses;

    if (intentData?.accountability_signal === 'excuse') consecutiveExcuses += 1;
    else if (intentData?.accountability_signal === 'ownership') consecutiveExcuses = 0;

    // ── 4b. Same-day early commitment (Issue 4) ───────────────────────────
    // Only surface if commitment_made_at is >30 minutes before now (not the current session)
    let sameDayCommitment = null;
    if (todayEarlyCommitment?.commitment && todayEarlyCommitment?.made_at) {
      const madeAtMs = new Date(todayEarlyCommitment.made_at).getTime();
      const thirtyMinutesMs = 30 * 60 * 1000;
      if (Date.now() - madeAtMs > thirtyMinutesMs) {
        sameDayCommitment = todayEarlyCommitment;
      }
    }

    // ── 5. Follow-ups & growth markers ───────────────────────────────────
    let dueFollowUp = followUpQueue.length > 0 ? followUpQueue[0] : null;
    // Suppress follow-up queue items when there's a commitment check-in pending —
    // the check-in must always come first
    if (yesterdayCommitment && dueFollowUp?.type === 'commitment_followup') {
      dueFollowUp = null;
    }
    const dueGrowthMarker = growthMarkers.length > 0 ? growthMarkers[0] : null;

    const followUpInstruction = dueFollowUp
      ? `\n\nFOLLOW-UP QUEUE: A follow-up question was queued from a previous session. Context: "${dueFollowUp.context}". Question to surface: "${dueFollowUp.question}". Weave this naturally into the session opening — do not announce it as a follow-up, just bring it up as if continuing the thread.`
      : '';

    const growthMarkerInstruction = dueGrowthMarker
      ? `\n\nGROWTH MARKER CHECK-IN: 14 days ago you were working through the theme "${dueGrowthMarker.theme}". ${dueGrowthMarker.check_in_message ? `Original note: "${dueGrowthMarker.check_in_message}".` : ''} Surface this naturally in the session — ask how it's going with that theme. Do not announce it as a scheduled check-in.`
      : '';

    // ── 6. Exercise cooldown + smart blocks ───────────────────────────────
    const sessionExercisesRun = Array.isArray(session_state.exercises_run) ? session_state.exercises_run : [];
    const messageCount = history.length;

    // Force commitment_checkin as current stage on INIT when yesterday commitment exists
    // so directives and context reflect the correct stage from the start of the session
    if (
      isInit &&
      (session_state.current_stage === 'wins' || !session_state.current_stage) &&
      yesterdayCommitment &&
      session_state.commitment_checkin_done !== true
    ) {
      session_state = { ...session_state, current_stage: 'commitment_checkin' };
    }

    let suggestedExercise = intentData?.suggested_exercise || 'none';
    const depthProbeAllowed = shouldAllowDepthProbe(session_state, messageCount);

    // Block implementation_intention if plan already captured
    if (suggestedExercise === 'implementation_intention' && session_state.tomorrow_commitment) {
      suggestedExercise = 'none';
    }
    // Block implementation_intention outside the tomorrow stage — it's a planning exercise, not a reflection exercise
    if (suggestedExercise === 'implementation_intention' && session_state.current_stage !== 'tomorrow') {
      suggestedExercise = 'none';
    }
    if (suggestedExercise === 'depth_probe' && !depthProbeAllowed) {
      suggestedExercise = 'none';
    }
    const exerciseAlreadyQueuedThisTurn = Array.isArray(session_state.directive_queue)
      && session_state.directive_queue.some((directive) => ['run_exercise', 'insight_triggered_exercise', 'depth_probe'].includes(directive.id));
    const insightTriggeredExercise = exerciseAlreadyQueuedThisTurn
      ? null
      : findInsightTriggeredExercise({
        userMessage: displayMessage,
        userInsights,
        sessionState: session_state,
        sessionExercisesRun,
        suggestedExercise,
      });

    // ── 6b. Stage hint ─────────────────────────────────────────────────
    const completedDirectives = Array.isArray(session_state.completed_directives) ? session_state.completed_directives : [];
    // Server-side fallback: detect wins_asked_for_more from last coach message
    // (GPT sometimes asks the follow-up question but forgets to set the flag)
    if (session_state.current_stage === 'wins' && !session_state.wins_asked_for_more && Array.isArray(history) && history.length > 0) {
      const lastCoachMsg = [...history].reverse().find(m => m.role === 'assistant');
      if (lastCoachMsg?.content) {
        const txt = lastCoachMsg.content.toLowerCase();
        if (
          txt.includes('what else went well') ||
          txt.includes('anything else') ||
          txt.includes("what's another") ||
          txt.includes('any other wins') ||
          txt.includes('anything else you want to celebrate') ||
          txt.includes('what else are you proud') ||
          txt.includes('share more') ||
          txt.includes('what else') ||
          txt.includes('tell me more') ||
          txt.includes('keep going') ||
          txt.includes('what other') ||
          txt.includes('any other')
        ) {
          session_state = { ...session_state, wins_asked_for_more: true };
        }
      }
    }
    const suggestedNextStage = deriveStageHint(
      session_state,
      intentData?.checklist_content,
      completedDirectives,
      messageCount,
      intentData,
      displayMessage
    );

    // ── 8. Build compact context block ───────────────────────────────────
    const exercisesExplained = Array.from(historicalExplainedExercises);
    const effectiveSuggestedExercise = insightTriggeredExercise?.exerciseId || suggestedExercise;
    const isFirstTimeExercise = effectiveSuggestedExercise !== 'none' && !historicalExplainedExercises.has(effectiveSuggestedExercise);

    // ── 8b. Memory search for question/advice/memory_query/reflective intents ────────
    const isMemoryMode = ['question', 'advice_request', 'memory_query'].includes(intentData?.intent);
    const shouldSearchMemories = isMemoryMode || intentData?.emotional_state === 'reflective';
    let relevantMemories = [];
    if (!isInit && shouldSearchMemories) {
      relevantMemories = await searchRelevantMemories(authenticatedUserId, displayMessage, 3);
    }

    const goalsContext = activeGoals.length > 0
      ? activeGoals.map((g) => {
          const obj = {
            id: g.id,
            area: g.category,
            title: g.title,
            whys: Array.isArray(g.whys) ? g.whys : [],
            vision_snapshot: g.vision_snapshot || null,
            depth_insights: g.depth_insights?.length > 0 ? g.depth_insights : null,
            suggested_next_action: g.suggested_next_action || null,
            motivation_signal: g.motivation_signal || 'unknown',
            baseline_snapshot: g.baseline_snapshot || null,
            baseline_date: g.baseline_date || null,
          };
          if (g.days_since_mentioned !== null && g.days_since_mentioned > 7) {
            obj.days_since_mentioned = g.days_since_mentioned;
          }
          return obj;
        })
      : [];

    const quietGoals = activeGoals
      .filter((g) => g.last_mentioned_at && g.days_since_mentioned > 14)
      .map((g) => ({
        goal_id: g.id,
        area: g.category,
        title: g.title,
        days_since_mentioned: g.days_since_mentioned,
        note: "hasn't come up recently — if a natural opening exists, one soft check-in is fine. If no opening, skip it.",
      }));

    const twoDaysAgo = localDate(-2, client_local_date);
    const goalsNeedWhyBuilding = activeGoals.filter((g) => {
      const hasWhys = Array.isArray(g.whys) && g.whys.length > 0;
      if (!hasWhys) return true;
      if (g.motivation_signal === 'strong') return false;
      if (g.motivation_signal === 'low' || g.motivation_signal === 'struggling') {
        const lastWhy = g.whys[g.whys.length - 1];
        return !lastWhy?.added_at || lastWhy.added_at < twoDaysAgo;
      }
      const stats = g.commitment_stats;
      if (stats?.rate_last_7 != null && stats.rate_last_7 < 0.4) return true;
      return false;
    });

    // ── Directive Queue ───────────────────────────────────────────────────
    let currentDirectiveQueue = Array.isArray(session_state.directive_queue) ? session_state.directive_queue : [];
    if (isExerciseSkipSignal) {
      currentDirectiveQueue = currentDirectiveQueue.map((directive) => (
        directive.id === 'insight_triggered_exercise'
          ? { ...directive, preferred_stage: 'close', priority: 2, fire_next_session: true }
          : directive
      ));
      session_state.insight_exercise_skipped = true;
    }

    // Derive values needed for directive conditions
    const mergedChecklist = { ...(session_state.checklist || {}), ...(intentData?.checklist_content || {}) };
    const tomorrowFilled = !!session_state.tomorrow_commitment;
    const hasMissInSession = Array.isArray(session_state.misses) && session_state.misses.length > 0;
    const honestMissing = !mergedChecklist.honest && !hasMissInSession;
    const bridgeDone = session_state.commitment_goal_bridge_done === true;
    const sessionReadyToClose = tomorrowFilled && !!session_state.commitment_minimum && bridgeDone;
    const EMERGENCY_CLOSE_THRESHOLD = 20;
    const forceClose = messageCount >= EMERGENCY_CLOSE_THRESHOLD && tomorrowFilled;
    const depthProbeNeeded = !!(intentData?.depth_opportunity && (session_state?.depth_opportunity_count ?? 0) >= 2 && depthProbeAllowed);
    const goalMissingWhy = goalsNeedWhyBuilding.find(g => !Array.isArray(g.whys) || g.whys.length === 0) ?? null;

    const newDirectives = buildDirectiveQueue({
      preSessionState,
      isMemoryMode,
      followUpQueue: dueFollowUp,
      growthMarkers: dueGrowthMarker,
      intentData,
      suggestedPractice: suggestedExercise,
      depthProbeNeeded,
      sessionState: session_state,
      profile,
      commitmentStats,
      commitmentRate7Context: resolvedCommitmentRate7,
      commitmentTrajectoryContext: resolvedCommitmentTrajectory,
      avgCommitmentScoreContext: resolvedAvgCommitmentScore,
      scoreTrajectoryContext: resolvedScoreTrajectory,
      yesterdayCommitment,
      yesterdayMinimum: yesterdayCommitmentDetails?.commitment_minimum || null,
      yesterdayStretch: yesterdayCommitmentDetails?.commitment_stretch || null,
      yesterdayCheckinOpener: yesterdayCommitmentDetails?.checkin_opener || null,
      yesterdayFragments,
      enrichedYesterdayFragments,
      goalMissingWhy,
      messageCount,
      sessionReadyToClose,
      forceClose,
      honestMissing,
      suggestedNextStage,
      history,
      insightTriggeredExercise,
      userInsights,
      recentSessions,
      effectiveConsecutiveExcuses,
      currentDirectiveQueue,
      completedDirectives,
      activeGoals,
    });

    // Combined queue: existing pending + newly generated (no duplicates)
    const currentQueueIds = new Set(currentDirectiveQueue.map(d => d.id));
    const combinedDirectiveQueue = [
      ...currentDirectiveQueue,
      ...newDirectives.filter(d => !currentQueueIds.has(d.id)),
    ];

    const currentStage = session_state.current_stage || 'commitment_checkin';
    // isInit messages skip directive dispatch — init has its own fixed opener logic
    const activeDirective = isInit
      ? null
      : dispatchNextDirective(combinedDirectiveQueue, currentStage, intentData?.emotional_state, messageCount, sessionExercisesRun);

    const contextBlock = buildSessionContext({
      profile,
      goalsContext,
      userInsights,
      sessionState: session_state,
      recentSessions,
      commitmentStats,
      followUpQueue: dueFollowUp,
      growthMarkers: dueGrowthMarker,
      suggestedPractice: effectiveSuggestedExercise,
      isFirstTimeExercise,
      exercisesExplained,
      intentData,
      preSessionState,
      yesterdayCommitment,
      yesterdayMinimum: yesterdayCommitmentDetails?.commitment_minimum || null,
      yesterdayStretch: yesterdayCommitmentDetails?.commitment_stretch || null,
      relevantMemories,
      clientDate: client_local_date,
      sameDayCommitment,
      activeGoals,
      quietGoals,
      goalsNeedWhyBuilding,
      messageCount,
      consecutiveExcuses,
      effectiveConsecutiveExcuses,
      suggestedNextStage,
      precomputedCommitmentScore: precomputedScore,
      streak: context.reflection_streak || context.streak || 0,
      daysSinceLastSession,
      activeDirective,
      directiveQueue: combinedDirectiveQueue,
      completedDirectives,
      progressEvents,
    });

    // ── 9. Build messages ─────────────────────────────────────────────────
    const exerciseInstruction = effectiveSuggestedExercise !== 'none' && EXERCISE_PROMPTS[effectiveSuggestedExercise]
      ? `\n\nEXERCISE WORKFLOW:\n${isFirstTimeExercise && EXERCISE_FIRST_TIME_INTROS[effectiveSuggestedExercise] ? `${EXERCISE_FIRST_TIME_INTROS[effectiveSuggestedExercise]}\n` : ''}${EXERCISE_PROMPTS[effectiveSuggestedExercise]}`
      : '';
    const insightMatchInstruction = insightTriggeredExercise
      ? `\n\nINSIGHT MATCH: The user just said something that matches a known pattern: "${insightTriggeredExercise.insightContext}". Consider opening with: "${EXERCISE_FIRST_TIME_INTROS[insightTriggeredExercise.exerciseId] || 'I want to try something here.'}" then running "${insightTriggeredExercise.exerciseId}".`
      : '';
    const effectiveSystemPrompt = SYSTEM_PROMPT + followUpInstruction + growthMarkerInstruction + exerciseInstruction + insightMatchInstruction + checklistResultContextInstruction;
    const messages = [{ role: 'system', content: effectiveSystemPrompt }, contextBlock, ...history.slice(-18)];

    if (!isInit) {
      messages.push({ role: 'user', content: displayMessage });
    } else {
      const stage = 'commitment_checkin';
      const streak = context.reflection_streak || context.streak || 0;
      const rate = resolvedCommitmentRate7;
      const trajectory = resolvedCommitmentTrajectory;
      const scoreTrajectory = resolvedScoreTrajectory;
      let commitmentContextNote = '';
      if (rate !== null && rate < 50) {
        commitmentContextNote = `NOTE: User has followed through on ${rate}% of commitments in the last 7 days (trajectory: ${trajectory}, score trajectory: ${scoreTrajectory || 'unknown'}). When the moment is right tonight — NOT in the opener — acknowledge this naturally. Don't lead with it. Find the right moment.`;
      } else if (rate !== null && rate >= 70 && trajectory === 'improving') {
        commitmentContextNote = `NOTE: User is on a strong run — ${rate}% follow-through, improving trajectory. Acknowledge momentum when wins come up tonight.`;
      }
      const returningContext = preSessionState?.returning_user_context
        ? `If it feels natural, you may lightly reference this from last session: "${preSessionState.returning_user_context}".`
        : '';
      messages.push({
        role: 'user',
        content: `Open the ${stage} stage of tonight's reflection. Start with a warm, direct greeting that fits this time of day: "${getTimeGreeting(client_tz_offset)}". Ask how they're doing right now in plain language. Keep it conversational and human.

Do NOT mention stages, process, forms, or instructions.
Do NOT tell them to pick a mood.
Do NOT say "what feels most present for you" or any variant of that phrasing.
Do NOT use coaching-speak openers (like "what's coming up for you" or "where are you at energetically"). Ask in plain, direct language — warm but not performative.
Do NOT use the phrase "what's underneath that."
Return mood chips in the JSON "chips" field only — don't call attention to them in assistant_message.
${returningContext}
${
          sameDayCommitment
            ? `Optional context: they made this same-day commitment this morning — "${sameDayCommitment.commitment}". If relevant, fold that in naturally while still asking about how they're doing right now.`
            : ''
        } ${streak > 1 ? `${streak}-night streak — acknowledge briefly.` : ''} ${commitmentContextNote}
Mood chips to return: [{"label":"Proud 🔥","value":"proud"},{"label":"Grateful 🙏","value":"grateful"},{"label":"Motivated 💪","value":"motivated"},{"label":"Okay 😐","value":"okay"},{"label":"Tired 😴","value":"tired"},{"label":"Stressed 😤","value":"stressed"}]`,
      });
    }

    // ── 10. Call GPT-4o ───────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: 1000,
    });

    let result;
    try {
      result = JSON.parse(completion.choices[0].message.content);
    } catch (_parseErr) {
      result = {
        assistant_message: completion.choices[0].message.content,
        chips: null, stage_advance: false, new_stage: null,
        extracted_data: {}, exercise_run: 'none',
        checklist_updates: { ...DEFAULT_CHECKLIST },
        stage_order_swapped: session_state.stage_order_swapped === true,
        follow_up_queued: false, is_session_complete: false,
      };
    }

    // Safety sanitizer: if assistant_message is itself a JSON object string, unwrap it and merge fields.
    // Find the first '{' in case there is non-JSON preamble text before it.
    if (typeof result.assistant_message === 'string') {
      const firstBrace = result.assistant_message.indexOf('{');
      if (firstBrace !== -1) {
        try {
          const inner = JSON.parse(result.assistant_message.slice(firstBrace));
          if (inner && typeof inner.assistant_message === 'string') {
            // Merge all fields from the inner object so is_session_complete etc. are preserved
            Object.assign(result, inner);
          }
        } catch (_e) { /* not valid JSON — leave as-is */ }
      }
    }
    // Final fallback: ensure assistant_message is never null/undefined/empty
    if (!result.assistant_message) {
      result.assistant_message = "I'm here — what's on your mind?";
    }
    // Strip leading/trailing whitespace and blank lines from the final message
    if (typeof result.assistant_message === 'string') {
      result.assistant_message = result.assistant_message.trim();
    }

    result.exercise_run = result.exercise_run || 'none';
    result.checklist_updates = result.checklist_updates || { ...DEFAULT_CHECKLIST };
    result.follow_up_queued = result.follow_up_queued || false;
    result.follow_up_triggered = result.follow_up_triggered === true;
    result.wins_asked_for_more = result.wins_asked_for_more === true;
    result.honest_depth = result.honest_depth === true;
    result.commitment_checkin_done = result.commitment_checkin_done === true;
    result.stage_order_swapped = result.stage_order_swapped === true || session_state.stage_order_swapped === true;
    result.show_commitment_checklist = result.show_commitment_checklist === true;
    result.checklist_fragments = Array.isArray(result.checklist_fragments) ? result.checklist_fragments : null;
    result.insight_exercise_skipped = session_state.insight_exercise_skipped === true || isExerciseSkipSignal;
    if (activeDirective?.id === 'insight_triggered_exercise' && result.exercise_run === activeDirective.exercise_id) {
      result.insight_exercise_skipped = false;
    }
    result.extracted_data = result.extracted_data || {};

    const stageAtTurnStart = session_state.current_stage || 'commitment_checkin';
    const canCaptureTomorrowCommitment = stageAtTurnStart === 'tomorrow';
    if (!canCaptureTomorrowCommitment) {
      result.extracted_data.commitment_minimum = null;
      result.extracted_data.commitment_stretch = null;
      result.extracted_data.tomorrow_commitment = null;
    }

    const resolvedMinimumCommitmentForOutput = result.extracted_data.commitment_minimum || session_state.commitment_minimum;
    const resolvedStretchCommitmentForOutput = result.extracted_data.commitment_stretch || session_state.commitment_stretch;
    if (!resolvedMinimumCommitmentForOutput || !resolvedStretchCommitmentForOutput) {
      result.extracted_data.tomorrow_commitment = null;
    }

    if (isInit && Array.isArray(yesterdayFragments) && yesterdayFragments.length > 0 && !session_state.commitment_checkin_done) {
      result.show_commitment_checklist = true;
      result.checklist_fragments = yesterdayFragments.map((fragment) => ({
        id: fragment.id,
        type: fragment.type || null,
        text: formatChecklistFragmentText(fragment),
      }));
    }

    const hasInsightDirectiveQueued = combinedDirectiveQueue.some((directive) => directive.id === 'insight_triggered_exercise');
    if (hasInsightDirectiveQueued && !isExerciseSkipSignal) {
      result.chips = [
        { label: "Let's go there", value: 'exercise_accept' },
        { label: 'Keep going', value: 'exercise_skip' },
      ];
    }
    if (result.extracted_data?.commitment_score != null) {
      const parsedScore = Number.parseFloat(result.extracted_data.commitment_score);
      result.extracted_data.commitment_score = Number.isFinite(parsedScore)
        ? Math.min(100, Math.max(0, Math.round(parsedScore)))
        : null;
    }
    if (precomputedScore !== null) {
      result.extracted_data = result.extracted_data || {};
      result.extracted_data.commitment_score = precomputedScore;
      result.commitment_checkin_done = true;
    }
    if (precomputedScore !== null && !result.extracted_data?.checkin_outcome) {
      result.extracted_data = result.extracted_data || {};
      if (precomputedScore === 0) result.extracted_data.checkin_outcome = 'missed';
      else if (precomputedScore === 100) result.extracted_data.checkin_outcome = 'kept';
      else result.extracted_data.checkin_outcome = 'partial';
    }
    result.checkin_outcome = result.extracted_data?.checkin_outcome || null;
    let depthProbeCount = Number(session_state.depth_probe_count || 0);
    let lastDepthProbeMessageIndex = Number.isFinite(Number(session_state.last_depth_probe_message_index))
      ? Number(session_state.last_depth_probe_message_index)
      : null;
    if (result.exercise_run === 'depth_probe') {
      depthProbeCount += 1;
      lastDepthProbeMessageIndex = messageCount;
    }
    result.depth_probe_count = depthProbeCount;
    result.last_depth_probe_message_index = lastDepthProbeMessageIndex;
    const insightExercisesTriggered = Array.isArray(session_state.insight_exercises_triggered)
      ? [...session_state.insight_exercises_triggered]
      : [];
    if (activeDirective?.id === 'insight_triggered_exercise' && activeDirective?.insight_id && !insightExercisesTriggered.includes(activeDirective.insight_id)) {
      insightExercisesTriggered.push(activeDirective.insight_id);
    }
    result.insight_exercises_triggered = insightExercisesTriggered;

    if (isInit) {
      result.stage_advance = true;
      result.new_stage = 'commitment_checkin';
    }

    const hasYesterdayCommitmentForCheckin = !!(session_state.yesterday_commitment || yesterdayCommitment);
    const shouldDecideOrderFromOpener = (
      !isInit &&
      !hasYesterdayCommitmentForCheckin
      && (session_state.current_stage || 'commitment_checkin') === 'commitment_checkin'
      && result.commitment_checkin_done === true
    );
    if (shouldDecideOrderFromOpener) {
      const openerDecision = deriveStageHint(
        {
          ...session_state,
          current_stage: 'commitment_checkin',
          commitment_checkin_done: true,
          stage_order_swapped: result.stage_order_swapped,
          yesterday_commitment: null,
        },
        intentData?.checklist_content,
        completedDirectives,
        messageCount,
        intentData,
        displayMessage
      );
      if (openerDecision === 'honest' || openerDecision === 'wins') {
        result.stage_order_swapped = openerDecision === 'honest';
        result.stage_advance = true;
        result.new_stage = openerDecision;
      }
    }

    // Mark a progress event as surfaced if the AI referenced it
    if (result.progress_event_surfaced && typeof result.progress_event_surfaced === 'string') {
      markProgressEventSurfaced(result.progress_event_surfaced); // fire-and-forget
    }

    // Safety guard — prevent hallucinated stage values from GPT
    const VALID_STAGES = ['wins', 'commitment_checkin', 'honest', 'tomorrow', 'complete'];
    if (result.new_stage && !VALID_STAGES.includes(result.new_stage)) {
      result.new_stage = null;
      result.stage_advance = false;
    }

    // Plan checklist correctness: cl.plan should only be true if tomorrow_commitment is actually captured
    // Not set by theme/intention language — only by real extracted commitment
    const planIsActuallyDone = !!(result.extracted_data?.tomorrow_commitment || session_state.tomorrow_commitment);
    if (!planIsActuallyDone) {
      result.checklist_updates.plan = false;
      if (intentData?.checklist_content) {
        intentData.checklist_content.plan = false;
      }
    }

    // Merge classifier checklist detections
    if (intentData?.checklist_content) {
      Object.keys(intentData.checklist_content).forEach((key) => {
        if (intentData.checklist_content[key]) result.checklist_updates[key] = true;
      });
    }

    // Bug 3A: Block wins→honest advance when wins_asked_for_more is not yet set and a win was captured
    const winsCapture = session_state.checklist?.wins === true || result.checklist_updates?.wins === true;
    const askedForMore = session_state.wins_asked_for_more === true || result.wins_asked_for_more === true;
    if (result.stage_advance === true && result.new_stage === 'honest' && winsCapture && !askedForMore) {
      result.stage_advance = false;
      result.new_stage = null;
    }

    // Bug 2D: Block tomorrow→complete advance when commitment_minimum or commitment_stretch is missing
    if (result.stage_advance === true && result.new_stage === 'complete' && stageAtTurnStart === 'tomorrow') {
      const hasMinimum = !!(result.extracted_data?.commitment_minimum || session_state.commitment_minimum);
      const hasStretch = !!(result.extracted_data?.commitment_stretch || session_state.commitment_stretch);
      if (!hasMinimum || !hasStretch) {
        result.stage_advance = false;
        result.new_stage = null;
      }
    }

    // ── Update directive tracking ─────────────────────────────────────────
    const firedDirectiveId = typeof result.directive_completed === 'string' ? result.directive_completed : null;
    let updatedDirectiveQueue = [...currentDirectiveQueue];
    let updatedCompletedDirectives = [...completedDirectives];

    if (firedDirectiveId) {
      updatedDirectiveQueue = updatedDirectiveQueue.filter(d => d.id !== firedDirectiveId);
      if (!updatedCompletedDirectives.includes(firedDirectiveId)) {
        updatedCompletedDirectives.push(firedDirectiveId);
      }
    }

    // Add newly generated directives to persistent queue (those not already queued or completed)
    const updatedQueueIds = new Set(updatedDirectiveQueue.map(d => d.id));
    for (const directive of newDirectives) {
      if (!updatedQueueIds.has(directive.id) && !updatedCompletedDirectives.includes(directive.id)) {
        updatedDirectiveQueue.push(directive);
        updatedQueueIds.add(directive.id);
      }
    }

    result.directive_queue = updatedDirectiveQueue;
    result.completed_directives = updatedCompletedDirectives;

    // Set commitment_goal_bridge_done when commitment_goal_why_depth directive completes
    if (firedDirectiveId === 'commitment_goal_why_depth' && session_id) {
      supabase.from('reflection_sessions')
        .update({ commitment_goal_bridge_done: true, updated_at: new Date().toISOString() })
        .eq('id', session_id)
        .then(() => {}).catch(() => {});
    }
    result.commitment_goal_bridge_done = firedDirectiveId === 'commitment_goal_why_depth'
      ? true
      : (session_state.commitment_goal_bridge_done === true);

    // ── 11. Post-response DB writes ───────────────────────────────────────
    const dbPromises = [];

    if (session_id && Object.values(result.checklist_updates).some(Boolean)) {
      dbPromises.push(updateSessionChecklist(session_id, result.checklist_updates));
    }
    if (session_id) {
      dbPromises.push(updateSessionExercise(session_id, result.exercise_run, consecutiveExcuses));
    }
    if (dueFollowUp && result.follow_up_triggered === true) {
      dbPromises.push(markFollowUpTriggered(dueFollowUp.id));
    }

    if (dueGrowthMarker) {
      supabase
        .from('growth_markers')
        .update({ checked_in: true, updated_at: new Date().toISOString() })
        .eq('id', dueGrowthMarker.id)
        .then(() => {})
        .catch(() => {});
    }
    const exerciseRan = result.exercise_run && result.exercise_run !== 'none';
    if (exerciseRan && session_id) {
      dbPromises.push(
        (async () => {
          const exerciseName = result.exercise_run.replace(/_/g, ' ');
          let followUpQuestion;
          try {
            const depthInsight = result.extracted_data?.depth_insight || null;
            const followUpCompletion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: `You are generating ONE follow-up question for a future reflection session, based on an exercise that was just completed.

The question should:
- Reference what the user actually worked on or the insight they reached during the exercise
- Be a single specific sentence that feels like a natural continuation
- NOT use bracket placeholders like [topic] or [their words]
- Sound like a coach checking in, not a form question

Return ONLY valid JSON: { "question": "..." }`,
                },
                {
                  role: 'user',
                  content: `Exercise run: ${exerciseName}\n${depthInsight ? `Depth insight from session: "${depthInsight}"\n` : ''}User profile: identity="${profile.identity_statement || 'not set'}", why="${profile.why || 'not set'}"`,
                },
              ],
              response_format: { type: 'json_object' },
              max_tokens: 100,
              temperature: 0.7,
            });
            const choice = followUpCompletion.choices?.[0];
            if (choice?.message?.content) {
              const followUpData = JSON.parse(choice.message.content);
              followUpQuestion = followUpData.question || null;
            }
          } catch (_e) { /* fail silently */ }

          if (!followUpQuestion) {
            followUpQuestion = `How has the work you did on ${exerciseName} been showing up since our last session?`;
          }

          await queueFollowUp(authenticatedUserId, session_id, {
            context: `${result.exercise_run} exercise run during reflection`,
            question: followUpQuestion,
            check_back_after: daysFromNow(3, client_local_date),
            trigger_condition: intentData?.emotional_state,
            type: 'exercise_followup',
          }, client_local_date);
        })()
      );
      dbPromises.push(
        upsertGrowthMarker(authenticatedUserId, result.exercise_run, {
          exercise_run: result.exercise_run,
          check_in_message: `How has your work on ${result.exercise_run.replace(/_/g, ' ')} been going?`,
        }, client_local_date)
      );
    }

    if (session_id && (result.stage_advance || result.extracted_data || result.is_session_complete || result.commitment_checkin_done || result.stage_order_swapped)) {
      const updates = {};
      if (result.stage_advance && result.new_stage) updates.current_stage = result.new_stage;
      if (result.extracted_data?.mood) updates.mood_end_of_day = result.extracted_data.mood;
      const resolvedMinimumCommitment = result.extracted_data?.commitment_minimum || session_state.commitment_minimum;
      const resolvedStretchCommitment = result.extracted_data?.commitment_stretch || session_state.commitment_stretch;
      if (result.extracted_data?.tomorrow_commitment && resolvedMinimumCommitment && resolvedStretchCommitment) {
        updates.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
        // Only set commitment_made_at when first setting the commitment
        if (!session_state.tomorrow_commitment) {
          updates.commitment_made_at = new Date().toISOString();
        }
      }
      if (result.extracted_data?.commitment_minimum && !session_state.commitment_minimum) {
        updates.commitment_minimum = result.extracted_data.commitment_minimum;
      }
      if (result.extracted_data?.commitment_stretch && !session_state.commitment_stretch) {
        updates.commitment_stretch = result.extracted_data.commitment_stretch;
      }
      if (result.extracted_data?.commitment_score != null) {
        updates.commitment_score = result.extracted_data.commitment_score;
      }
      if (result.extracted_data?.self_hype_message) updates.self_hype_message = result.extracted_data.self_hype_message;
      if (result.commitment_checkin_done) updates.commitment_checkin_done = true;
      if (result.stage_order_swapped === true) updates.stage_order_swapped = true;
      if (result.extracted_data?.checkin_outcome) updates.checkin_outcome = result.extracted_data.checkin_outcome;
      if (result.depth_probe_count != null) updates.depth_probe_count = result.depth_probe_count;
      if (result.last_depth_probe_message_index != null) updates.last_depth_probe_message_index = result.last_depth_probe_message_index;
      if (Array.isArray(result.insight_exercises_triggered)) updates.insight_exercises_triggered = result.insight_exercises_triggered;
      if (result.insight_exercise_skipped === true) updates.insight_exercise_skipped = true;
      if (result.is_session_complete) {
        updates.is_complete = true;
        updates.completed_at = new Date().toISOString();
      }
      if (Object.keys(updates).length > 0) {
        dbPromises.push(
          supabase.from('reflection_sessions')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', session_id).then(() => {}).catch(() => {})
        );
      }

      // Propagate checkin_outcome to goal_commitment_log rows for yesterday
      const resolvedCheckinOutcome = result.extracted_data?.checkin_outcome;
      if (['kept', 'missed', 'partial'].includes(resolvedCheckinOutcome) && client_local_date) {
        const yesterdayForCheckin = localDate(-1, client_local_date);
        supabase
          .from('goal_commitment_log')
          .update({ checkin_outcome: resolvedCheckinOutcome })
          .eq('user_id', authenticatedUserId)
          .eq('date', yesterdayForCheckin)
          .is('kept', null)
          .then(() => {}).catch(() => {});
      }
      if (result.is_session_complete && client_local_date) {
        dbPromises.push(
          supabase.from('user_profiles')
            .update({ last_session_completed_at: today(client_local_date) })
            .eq('id', authenticatedUserId).then(() => {}).catch(() => {})
        );
      }
    }

    // Log minimum/stretch commitment fragments once both are captured.
    if (
      client_local_date &&
      (
        (result.extracted_data?.commitment_minimum && !session_state.commitment_minimum)
        || (result.extracted_data?.commitment_stretch && !session_state.commitment_stretch)
      )
      && (result.extracted_data?.commitment_minimum || session_state.commitment_minimum)
      && (result.extracted_data?.commitment_stretch || session_state.commitment_stretch)
    ) {
      (async () => {
        try {
          const minimumCommitmentText = result.extracted_data?.commitment_minimum || session_state.commitment_minimum;
          const stretchCommitmentText = result.extracted_data?.commitment_stretch || session_state.commitment_stretch;
          const goalList = activeGoals.map((g) => ({ id: g.id, title: g.title, category: g.category }));
          const clientToday = today(client_local_date);

          const resolveGoalId = async (commitmentText) => {
            if (!commitmentText || goalList.length === 0) return null;
            try {
              const extraction = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: `You map one commitment line to one goal_id from the provided list, or null if no clear match.
Return ONLY valid JSON: { "goal_id": "uuid or null" }
Only return a goal_id that exists in the list.`,
                  },
                  {
                    role: 'user',
                    content: JSON.stringify({ commitment: commitmentText, goals: goalList }),
                  },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 80,
              });
              const extracted = JSON.parse(extraction.choices[0].message.content || '{}');
              return (extracted.goal_id && activeGoals.some((g) => g.id === extracted.goal_id)) ? extracted.goal_id : null;
            } catch (_e) {
              return null;
            }
          };

          const [minimumGoalId, stretchGoalId] = await Promise.all([
            resolveGoalId(minimumCommitmentText),
            resolveGoalId(stretchCommitmentText),
          ]);

          const fragmentRows = [
            {
              user_id: authenticatedUserId,
              session_id: session_id || null,
              goal_id: minimumGoalId,
              commitment_text: minimumCommitmentText,
              date: clientToday,
              kept: null,
              fragment_index: 0, // fallback convention for minimum when commitment_type is unavailable
              commitment_type: 'minimum',
            },
            {
              user_id: authenticatedUserId,
              session_id: session_id || null,
              goal_id: stretchGoalId,
              commitment_text: stretchCommitmentText,
              date: clientToday,
              kept: null,
              fragment_index: 1, // fallback convention for stretch when commitment_type is unavailable
              commitment_type: 'stretch',
            },
          ];

          const { error: insertError } = await supabase.from('goal_commitment_log').insert(fragmentRows);
          if (insertError && /commitment_type/i.test(insertError.message || '')) {
            const fallbackRows = fragmentRows.map(({ commitment_type: _commitmentType, ...row }) => row);
            await supabase.from('goal_commitment_log').insert(fallbackRows);
          }
        } catch (_e) { /* fail silently */ }
      })();
    }

    // Write wins to session row atomically (avoids read-then-write race condition)
    if (session_id && result.extracted_data?.win_text) {
      dbPromises.push(
        Promise.resolve(
          supabase.rpc('append_jsonb_array_item', {
            p_table: 'reflection_sessions',
            p_column: 'wins',
            p_id: session_id,
            p_item: { text: result.extracted_data.win_text },
            p_dedup_key: 'text',
          })
        ).catch((e) => console.error('Failed to persist win to session:', e))
      );
    }

    // Write misses to session row atomically (avoids read-then-write race condition)
    if (session_id && result.extracted_data?.miss_text) {
      dbPromises.push(
        Promise.resolve(
          supabase.rpc('append_jsonb_array_item', {
            p_table: 'reflection_sessions',
            p_column: 'misses',
            p_id: session_id,
            p_item: { text: result.extracted_data.miss_text },
            p_dedup_key: 'text',
          })
        ).catch((e) => console.error('Failed to persist miss to session:', e))
      );
    }

    // ── Progress event writes (fire-and-forget) ────────────────────────────────

    // Event 1: motivation_signal_change per goal
    if (activeGoals?.length) {
      dbPromises.push(
        (async () => {
          for (const goal of activeGoals) {
            if (!goal.id || !goal._goalStats) continue;
            const newSignal = computeGoalMotivationSignal(goal._goalStats, goal);
            const prevSignal = goal.last_motivation_signal;
            if (prevSignal && prevSignal !== newSignal && newSignal !== 'unknown') {
              // Persist new signal for next-session comparison
              supabase.from('goals')
                .update({ last_motivation_signal: newSignal })
                .eq('id', goal.id)
                .then(() => {}).catch(() => {});

              let displayText = null;
              if (newSignal === 'strong') {
                displayText = `Your follow-through on "${goal.title}" just hit strong territory — a real shift from ${prevSignal}.`;
              } else if (newSignal === 'medium' && prevSignal === 'low') {
                displayText = `Your commitment follow-through on "${goal.title}" crossed 40%. Something is changing.`;
              } else if (newSignal === 'low' && (prevSignal === 'medium' || prevSignal === 'strong')) {
                displayText = `Follow-through on "${goal.title}" has slipped below 40%. Worth paying attention to.`;
              } else if (newSignal === 'struggling') {
                displayText = `"${goal.title}" hasn't come up in a while and follow-through is declining. Worth naming.`;
              }
              if (displayText) {
                await writeProgressEvent(authenticatedUserId, session_id, 'motivation_signal_change', {
                  goal_id: goal.id,
                  goal_title: goal.title,
                  from: prevSignal,
                  to: newSignal,
                  display_text: displayText,
                });
              }
            } else if (!prevSignal && newSignal !== 'unknown') {
              // First time signal computed — store it silently, no event
              supabase.from('goals')
                .update({ last_motivation_signal: newSignal })
                .eq('id', goal.id)
                .then(() => {}).catch(() => {});
            }
          }
        })()
      );
    }

    // Event 2: followthrough_milestone crossing
    if (commitmentStats) {
      const { rate7, trajectory: ct } = commitmentStats;
      dbPromises.push(
        (async () => {
          const { data: existingMilestone } = await supabase
            .from('user_progress_events')
            .select('id')
            .eq('user_id', authenticatedUserId)
            .eq('event_type', 'followthrough_milestone')
            .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
            .limit(1)
            .maybeSingle();

          if (!existingMilestone) {
            if (rate7 >= MOTIVATION_STRONG_THRESHOLD && ct !== 'declining') {
              await writeProgressEvent(authenticatedUserId, session_id, 'followthrough_milestone', {
                rate: rate7,
                tier: 'strong',
                display_text: `Your overall commitment follow-through just hit ${Math.round(rate7 * 100)}% — your strongest stretch yet.`,
              });
            } else if (rate7 >= MOTIVATION_MEDIUM_THRESHOLD && ct === 'improving') {
              await writeProgressEvent(authenticatedUserId, session_id, 'followthrough_milestone', {
                rate: rate7,
                tier: 'medium',
                display_text: `Your follow-through rate just crossed 40% and is trending up. That's a real shift.`,
              });
            }
          }
        })()
      );
    }

    // Event 3: foothold_unlocked (user_insight with foothold not yet recorded as an event)
    if (Array.isArray(userInsights)) {
      for (const insight of userInsights) {
        if (insight.foothold && !insight._had_foothold_previously) {
          dbPromises.push(
            writeProgressEvent(authenticatedUserId, session_id, 'foothold_unlocked', {
              insight_id: insight.id,
              pattern_label: insight.pattern_label,
              foothold: insight.foothold,
              display_text: `Something is shifting with "${insight.pattern_label}": ${insight.foothold}`,
            })
          );
        }
      }
    }

    // Event 4: first_depth_insight on a goal
    if (Array.isArray(activeGoals)) {
      dbPromises.push(
        (async () => {
          for (const goal of activeGoals) {
            if (!goal.id || goal._had_depth_insight_previously) continue;
            const depthInsights = Array.isArray(goal.depth_insights) ? goal.depth_insights : [];
            if (depthInsights.length === 1) {
              await writeProgressEvent(authenticatedUserId, session_id, 'first_depth_insight', {
                goal_id: goal.id,
                goal_title: goal.title,
                insight: depthInsights[0].insight,
                date: depthInsights[0].date,
                display_text: `You had your first real insight about "${goal.title}" on ${depthInsights[0].date}: "${depthInsights[0].insight && depthInsights[0].insight.length > 80 ? depthInsights[0].insight.slice(0, 80) + '...' : (depthInsights[0].insight || '')}"`,
              });
            }
          }
        })()
      );
    }

    // Event 5: blocker_fading (blocker insight not seen in 14+ days)
    if (Array.isArray(userInsights) && client_local_date) {
      const fourteenDaysAgo = localDate(-14, client_local_date);
      const fadingBlockers = userInsights.filter(
        (ins) => ins.pattern_type === 'blocker' && ins.last_seen_date && ins.last_seen_date < fourteenDaysAgo && (ins.sessions_synthesized_from || 0) >= 3
      );
      for (const blocker of fadingBlockers) {
        dbPromises.push(
          (async () => {
            const { data: existingFade } = await supabase
              .from('user_progress_events')
              .select('id')
              .eq('user_id', authenticatedUserId)
              .eq('event_type', 'blocker_fading')
              .contains('payload', { label: blocker.pattern_label })
              .maybeSingle();
            if (!existingFade) {
              await writeProgressEvent(authenticatedUserId, session_id, 'blocker_fading', {
                label: blocker.pattern_label,
                last_seen_date: blocker.last_seen_date,
                occurrence_count: blocker.sessions_synthesized_from,
                display_text: `"${blocker.pattern_label}" showed up ${blocker.sessions_synthesized_from} times but hasn't appeared since ${blocker.last_seen_date}. That pattern may be fading.`,
              });
            }
          })()
        );
      }
    }

    Promise.all(dbPromises).catch(() => {});

    // ── Goal write-backs (fire-and-forget, all fail silently) ─────────────
    const clientToday = today(client_local_date);

    // Goal why insight — smart append/replace to goals.whys array
    if (result.extracted_data?.goal_why_insight && result.extracted_data?.goal_id_referenced) {
      const goalId = result.extracted_data.goal_id_referenced;
      const action = result.extracted_data.goal_why_action;
      const replaceIndex = result.extracted_data.goal_why_replace_index;
      const newWhy = {
        text: result.extracted_data.goal_why_insight,
        added_at: clientToday,
        source: result.extracted_data.goal_commitment_why === true ? 'commitment_planning' : 'reflection_session',
        motivation_signal: null,  // computed behaviorally, not by AI extraction
        session_id: session_id || null,
      };

      (async () => {
        try {
          const { data: goalData } = await supabase
            .from('goals')
            .select('whys, title')
            .eq('id', goalId)
            .eq('user_id', authenticatedUserId)
            .single();

          let currentWhys = Array.isArray(goalData?.whys) ? [...goalData.whys] : [];

          if (newWhy.source === 'commitment_planning') {
            // Commitment-planning whys: always replace the single existing one, never accumulate
            const existingIdx = currentWhys.findIndex(w => w.source === 'commitment_planning');
            if (existingIdx >= 0) {
              currentWhys[existingIdx] = newWhy;
            } else {
              currentWhys.push(newWhy);
            }
          } else if (action === 'replace' && typeof replaceIndex === 'number' && currentWhys[replaceIndex]) {
            currentWhys[replaceIndex] = newWhy;
          } else {
            currentWhys.push(newWhy);
          }

          // Enforce retention policy
          const commitmentWhys = currentWhys.filter(w => w.source === 'commitment_planning').slice(-MAX_COMMITMENT_WHYS);
          const sessionWhys = currentWhys.filter(w => w.source !== 'commitment_planning').slice(-MAX_SESSION_WHYS);
          currentWhys = [...commitmentWhys, ...sessionWhys].slice(-MAX_WHYS_TOTAL);

          await supabase
            .from('goals')
            .update({ whys: currentWhys, last_mentioned_at: clientToday })
            .eq('id', goalId)
            .eq('user_id', authenticatedUserId);

          // Fire-and-forget why_summary synthesis
          synthesizeGoalWhySummary(authenticatedUserId, goalId, goalData?.title || '').catch(() => {});
        } catch (_e) { /* fail silently */ }
      })();
    }

    // Goal why-probe insight write-back
    if (result.extracted_data?.goal_why_probe_insight?.goal_id && result.extracted_data?.goal_why_probe_insight?.text) {
      const probe = result.extracted_data.goal_why_probe_insight;
      const newWhy = {
        text: probe.text,
        added_at: clientToday,
        source: 'why_probe',
        motivation_signal: null,
        session_id: session_id || null,
      };

      (async () => {
        try {
          const { data: goalData } = await supabase
            .from('goals')
            .select('whys, title')
            .eq('id', probe.goal_id)
            .eq('user_id', authenticatedUserId)
            .single();

          let currentWhys = Array.isArray(goalData?.whys) ? [...goalData.whys] : [];

          if (probe.action === 'replace' && typeof probe.replace_index === 'number' && currentWhys[probe.replace_index]) {
            currentWhys[probe.replace_index] = newWhy;
          } else {
            currentWhys.push(newWhy);
          }

          // Retention policy: max MAX_WHY_PROBE_WHYS why_probe entries per goal, plus existing caps
          const commitmentWhys = currentWhys.filter(w => w.source === 'commitment_planning').slice(-MAX_COMMITMENT_WHYS);
          const probeWhys = currentWhys.filter(w => w.source === 'why_probe').slice(-MAX_WHY_PROBE_WHYS);
          const sessionWhys = currentWhys.filter(w => w.source !== 'commitment_planning' && w.source !== 'why_probe').slice(-MAX_SESSION_WHYS);
          currentWhys = [...commitmentWhys, ...probeWhys, ...sessionWhys].slice(-MAX_WHYS_TOTAL);

          await supabase
            .from('goals')
            .update({ whys: currentWhys, last_mentioned_at: clientToday })
            .eq('id', probe.goal_id)
            .eq('user_id', authenticatedUserId);

          synthesizeGoalWhySummary(authenticatedUserId, probe.goal_id, goalData?.title || '').catch(() => {});
        } catch (_e) { /* fail silently */ }
      })();
    }
    if (result.extracted_data?.goal_vision_fragment && result.extracted_data?.goal_id_referenced) {
      const goalId = result.extracted_data.goal_id_referenced;
      supabase
        .from('goals')
        .update({
          vision_snapshot: result.extracted_data.goal_vision_fragment,
          last_mentioned_at: clientToday,
        })
        .eq('id', goalId)
        .eq('user_id', authenticatedUserId)
        .then(() => {}).catch(() => {});
    }

    // Goal depth insight — append to goals.depth_insights array
    if (result.extracted_data?.goal_depth_insight && result.extracted_data?.goal_id_referenced) {
      const goalId = result.extracted_data.goal_id_referenced;
      supabase
        .from('goals')
        .select('depth_insights')
        .eq('id', goalId)
        .eq('user_id', authenticatedUserId)
        .maybeSingle()
        .then(({ data }) => {
          const current = Array.isArray(data?.depth_insights) ? data.depth_insights : [];
          const updated = [
            ...current.slice(-MAX_DEPTH_INSIGHTS_RETAINED), // keep last 4 max
            { date: clientToday, insight: result.extracted_data.goal_depth_insight },
          ];
          return supabase
            .from('goals')
            .update({ depth_insights: updated, last_mentioned_at: clientToday })
            .eq('id', goalId)
            .eq('user_id', authenticatedUserId);
        })
        .then(() => {}).catch(() => {});
    }

    // Progress feeling — append to goal's depth_insights as a tagged entry if meaningful
    if (result.extracted_data?.progress_feeling && result.extracted_data?.goal_id_referenced) {
      const goalId = result.extracted_data.goal_id_referenced;
      supabase
        .from('goals')
        .select('depth_insights')
        .eq('id', goalId)
        .eq('user_id', authenticatedUserId)
        .maybeSingle()
        .then(({ data }) => {
          const current = Array.isArray(data?.depth_insights) ? data.depth_insights : [];
          const updated = [
            ...current.slice(-MAX_DEPTH_INSIGHTS_RETAINED),
            { date: clientToday, insight: result.extracted_data.progress_feeling, type: 'progress_feeling' },
          ];
          return supabase
            .from('goals')
            .update({ depth_insights: updated, last_mentioned_at: clientToday })
            .eq('id', goalId)
            .eq('user_id', authenticatedUserId);
        })
        .then(() => {}).catch(() => {});
    }

    // Goal suggestion — handle new_goal and pause actions
    if (result.extracted_data?.goal_suggestion) {
      const suggestion = result.extracted_data.goal_suggestion;
      if (suggestion.action === 'new_goal' && suggestion.title) {
        // New goal suggestion: pass it through in the response so the frontend can show accept/dismiss UI
        // The frontend will call create-goal if accepted; no server-side creation here
        result.goal_suggestion_pending = suggestion;
      } else if (suggestion.action && suggestion.goal_id) {
        const goalTitle = activeGoals.find(g => g.id === suggestion.goal_id)?.title || 'that goal';
        queueFollowUp(authenticatedUserId, session_id, {
          context: `goal_suggestion: action=${suggestion.action}, goal_id=${suggestion.goal_id}, reason="${suggestion.reason}"`,
          question: suggestion.action === 'pause'
            ? `Last time you mentioned you might want to pause your goal around "${goalTitle}". Is that still where you're at?`
            : `You mentioned wanting to work on "${goalTitle}". Before we dive in — what makes that actually matter to you? Not the goal itself, but what's underneath it?`,
          check_back_after: 1,
          trigger_condition: 'always',
          type: 'commitment_followup',
        }, client_local_date).catch(() => {});
      }
    }

    // Update last_mentioned_at for any goal referenced this message
    if (result.extracted_data?.goal_id_referenced) {
      supabase
        .from('goals')
        .update({ last_mentioned_at: clientToday })
        .eq('id', result.extracted_data.goal_id_referenced)
        .eq('user_id', authenticatedUserId)
        .then(() => {}).catch(() => {});
    }

    // Post-session background work — fire and forget
    if (result.is_session_complete && session_id) {
      (async () => {
        try {
          const summaryText = generateSessionSummary(session_state, result, profile, today(client_local_date));
          const embedding = await generateEmbedding(summaryText);
          const sessionUpdates = { summary: summaryText };
          const resolvedCommitmentMinimum = result.extracted_data?.commitment_minimum || session_state.commitment_minimum || null;
          const resolvedCommitmentStretch = result.extracted_data?.commitment_stretch || session_state.commitment_stretch || null;
          const resolvedMood = result.extracted_data?.mood || session_state.mood_end_of_day || null;
          const latestWin = result.extracted_data?.win_text || session_state?.wins?.slice?.(-1)?.[0]?.text || null;
          const latestMiss = result.extracted_data?.miss_text || session_state?.misses?.slice?.(-1)?.[0]?.text || null;
          const keySessionSignal = latestWin || latestMiss || 'no single highlight captured';

          // SUPABASE MIGRATION NOTE: reflection_sessions requires a nullable `checkin_opener` TEXT column.
          if (resolvedCommitmentMinimum || resolvedCommitmentStretch) {
            try {
              const openerCompletion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: `Generate one warm, specific opener sentence for tomorrow's commitment check-in.
Return ONLY valid JSON: { "checkin_opener": "..." }.
The sentence should reference yesterday's commitment naturally and sound conversational.`,
                  },
                  {
                    role: 'user',
                    content: JSON.stringify({
                      commitment_minimum: resolvedCommitmentMinimum,
                      commitment_stretch: resolvedCommitmentStretch,
                      mood_end_of_day: resolvedMood,
                      key_win_or_miss: keySessionSignal,
                      identity_statement: profile.identity_statement || null,
                    }),
                  },
                ],
                response_format: { type: 'json_object' },
                max_tokens: 120,
                temperature: 0.7,
              });
              const openerData = JSON.parse(openerCompletion.choices?.[0]?.message?.content || '{}');
              if (typeof openerData.checkin_opener === 'string' && openerData.checkin_opener.trim()) {
                sessionUpdates.checkin_opener = openerData.checkin_opener.trim();
              }
            } catch (_e) { /* fail silently */ }
          }
          if (embedding) sessionUpdates.embedding = embedding;
          await supabase.from('reflection_sessions').update(sessionUpdates).eq('id', session_id);
          await evolveUserProfile(authenticatedUserId, summaryText, userProfile, recentSessions, session_id);

          // Shallow session detector — if wins or honest checklist items are missing,
          // queue a strategic follow-up for the next night
          const checklist = session_state?.checklist || {};
          const messageCount = Array.isArray(history) ? history.length : 0;
          const isShallow = messageCount < MIN_DEEP_SESSION_MESSAGE_COUNT || (!checklist.honest) || (!checklist.wins);

          if (isShallow) {
            try {
              const followUpCompletion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: `You are generating ONE strategic follow-up question for the next reflection session, based on a session summary that felt surface-level.

The question should:
- Dig into something that was mentioned but not fully explored
- Connect to their identity, why, or future self
- Feel natural, not clinical
- Be 1 sentence only

Return ONLY valid JSON: { "question": "...", "context": "brief context on why this was queued" }`,
                  },
                  {
                    role: 'user',
                    content: `Session summary: ${summaryText}\n\nUser profile: identity="${userProfile?.identity_statement || 'not set'}", why="${userProfile?.why || 'not set'}", future_self="${userProfile?.future_self || 'not set'}"`,
                  },
                ],
                response_format: { type: 'json_object' },
                max_tokens: 150,
                temperature: 0.7,
              });
              const followUpData = JSON.parse(followUpCompletion.choices[0].message.content);
              if (followUpData.question) {
                await queueFollowUp(authenticatedUserId, session_id, {
                  context: followUpData.context || 'Auto-queued from shallow session detector',
                  question: followUpData.question,
                  check_back_after: daysFromNow(1, client_local_date),
                  trigger_condition: null,
                  type: 'depth_followup',
                }, client_local_date);
              }
            } catch (_e) { /* fail silently */ }
          }

          // Flush unresolved directives that should carry to next session
          try {
            const pendingCarryOver = updatedDirectiveQueue.filter(d => d.fire_next_session === true);
            for (const directive of pendingCarryOver) {
              await queueFollowUp(authenticatedUserId, session_id, {
                context: `directive_deferred: ${directive.id}`,
                question: directive.followup_question || `Following up on something we didn't get to last session — ${directive.id.replace(/_/g, ' ')}.`,
                check_back_after: daysFromNow(1, client_local_date),
                trigger_condition: null,
                type: getFollowUpTypeForDirective(directive.id),
              }, client_local_date).catch(() => {});
            }
          } catch (_e) { /* fail silently */ }

          // Mark commitments from 2+ days ago that are still null as missed
          try {
            const twoDaysAgo = localDate(-2, client_local_date);
            await supabase
              .from('goal_commitment_log')
              .update({ kept: false, evaluated_at: new Date().toISOString() })
              .eq('user_id', authenticatedUserId)
              .lt('date', twoDaysAgo)
              .is('kept', null);
          } catch (_e) { /* fail silently */ }
        } catch (_e) {}
      })();
      const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
      const authToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      triggerInsightSynthesis(authenticatedUserId, authToken);
    }

    result.consecutive_excuses = consecutiveExcuses;
    if (preSessionState) result.pre_session_state = preSessionState;

    // Persist cross-session excuse count to user_profiles
    if (intentData?.accountability_signal === 'excuse') {
      supabase.from('user_profiles')
        .update({ consecutive_excuse_sessions: effectiveConsecutiveExcuses + 1 })
        .eq('id', authenticatedUserId)
        .then(() => {}).catch(() => {});
    } else if (intentData?.accountability_signal === 'ownership') {
      supabase.from('user_profiles')
        .update({ consecutive_excuse_sessions: 0 })
        .eq('id', authenticatedUserId)
        .then(() => {}).catch(() => {});
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Error in reflection-coach:', error);
    return res.status(500).json({
      error: 'Failed to process reflection',
      assistant_message: "Something went wrong on my end. Try sending that again — I'm here.",
      chips: null, stage_advance: false, new_stage: null,
      extracted_data: {}, exercise_run: 'none',
      checklist_updates: { ...DEFAULT_CHECKLIST },
      stage_order_swapped: false,
      follow_up_queued: false, is_session_complete: false,
      consecutive_excuses: 0,
    });
  }
}
