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

const DEFAULT_CHECKLIST = { wins: false, honest: false, plan: false, identity: false };
const MIN_DEEP_SESSION_MESSAGE_COUNT = 6;
const MAX_DEPTH_INSIGHTS_RETAINED = 4;

// ── Motivation signal thresholds ──────────────────────────────────────────────
const MOTIVATION_STRONG_THRESHOLD = 0.7;   // ≥70% follow-through → strong
const MOTIVATION_MEDIUM_THRESHOLD = 0.4;   // ≥40% follow-through → medium; <40% → low
const MIN_EVALUABLE_COMMITMENTS = 3;       // minimum logged entries before signal is meaningful
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
Good depth questions (use naturally, not robotically):
  "Why do you think you keep coming back to that?"
  "What's the story you're telling yourself about [X]?"
  "If you're honest, what do you think is actually driving that?"
  "What does [action/pattern] say about what you believe about yourself?"
  "What would have to be true about you for that to keep happening?"
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

ON THE CHECKLIST (wins / honest / plan / identity):
- These are background goals — track silently from conversation
- wins: a real win or effort was mentioned. After the FIRST win is mentioned, always follow up with an open invitation to share more: e.g. "What else went well today?" or "What's another one?" — do NOT advance to the honest stage after just one win exchange. Let the user share as many wins as they want before moving on. Set wins_asked_for_more: true in the response only after you have asked this "what else?" question at least once. If the user responds with a list of wins (e.g. "sleep, app work, boxing"), you MAY ask about multiple items from that list in the same response — this is the ONE exception to the one-question rule. Only transition to honest after the user clearly signals they are done sharing wins.
- commitment_checkin: ask how yesterday's commitment went. One question only. If kept → celebrate + transition to honest. If missed → that IS the honest moment — transition naturally. Set commitment_checkin_done: true once answered. Skip entirely if no yesterday_commitment exists.
- honest: they acknowledged something they're struggling with or could improve. When a miss or honest moment is named, do NOT immediately close the honest stage or set honest_depth: true. Ask the one question that goes underneath it — not "what would you do differently" (that belongs in tomorrow) but something like "what was actually going on for you underneath that?" or "what do you think was really happening?" One question at a time — evaluate the answer before deciding whether to go deeper or close. Evaluate qualitatively: has the user answered what was actually happening underneath the surface behavior? A surface miss ("I didn't get to it", "I got distracted", "I forgot") is NOT enough. You need a genuine answer to the underneath layer — the real reason, the emotional truth, the internal conflict. Once you have a real answer to that underneath question, THEN you may set honest_depth: true. Do NOT count exchanges or use a fixed sequence — evaluate the quality of what they've said. If the answer is still surface-level, ask the one next question that goes deeper.
- plan: a concrete tomorrow commitment was stated
- identity: they made a statement about who they are or are becoming
- After ~8 messages, if items are still empty, weave them in naturally
- Never say "you haven't completed X" — natural human transitions only
- If honest is missing after wins are covered, gently probe with self-awareness questions like: "Where did you feel like you weren't fully showing up today?" or "Is there a moment from today that's still sitting with you?" or "What part of today are you least proud of — not what you'd fix, just what happened?" The goal of the honest stage is self-awareness and honest naming of who they were TODAY — NOT planning or action. Do NOT ask "what would you do differently" or any future-action questions during the honest stage — those belong in the tomorrow stage.
- If identity is missing near the end, ask: "What does [their actions/plan] say about who you're becoming?"

ON KNOWING WHEN TO CLOSE:
- When tomorrow_commitment is filled AND the user's tone is resolved/satisfied → wrap
- Do NOT keep drilling a topic that's already been answered
- If they've stated a clear plan and responded positively, that thread is CLOSED
- A good close is a warm send-off with a final identity statement, not an interrogation
- Set is_session_complete: true when wins + plan are covered and conversation has natural resolution
- If the user has clearly answered a question, even informally ("I'll just know", "I'm not worried about it", "I'll figure it out"), that topic is CLOSED. Do not follow up on it.
- A closed topic means: move forward or wrap up. Never re-ask what was just answered.

ON VENTING:
- One message of full acknowledgment
- Then: "Okay — and what part of that is yours to work with?"
- Empowering, not harsh. You believe in their agency.

ON EXERCISES:
- Briefly explain WHY and what the user will get out of it (1 sentence, only first time — check exercises_explained). E.g. "This one's about finding the thing that's still working even when everything feels off — [question]" or "I want to try something — it helps name what's actually driving you — [question]". Frame the benefit, not just the name.
- After exercise: connect result back to identity, goals, or future self
- NEVER repeat an exercise in exercises_run for this session
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

7. LIGHTWEIGHT WHY — COMMITMENT PLANNING:
   When the user states their tomorrow commitment and it connects to a goal you're tracking, ask ONE lightweight question: "What's making that the priority tomorrow?" — only if their message doesn't already contain a motivation signal (i.e. they didn't say "because...", "I need to...", or volunteer a reason inline). This is NOT a full why-building exercise — one question only, no follow-up drilling. If they answer with a motivation, set goal_why_action: "add", goal_why_insight to their actual words, goal_id_referenced to the matching goal, and goal_commitment_why: true so the write-back uses source "commitment_planning". Skip entirely if: the commitment message already contains a motivation signal (words like "because", "I need to", "so that", "want to", "trying to", or the user volunteers a reason inline), no goal match is clear, or a full why-building moment already happened this session for this goal.

8. TOMORROW STAGE — GOAL CHIPS:
   When you are in the 'tomorrow' stage and you ask the user what they are committing to tomorrow (the first question in that stage asking for their commitment), include '"show_goal_chips": true' in your JSON response. This signals the UI to show the user's active goals as selectable chips above the text input so they can quickly pick which goals they're committing to. Only set show_goal_chips: true on that one question — do NOT set it on follow-up probing questions about specifics within the tomorrow stage, and do not set it on any other stage.

WHAT NOT TO DO:
- Never announce you're doing a "goal check-in"
- Never redirect a conversation that's already going somewhere real just to fit in a goal
- Never manufacture a moment that isn't there

FUTURE SELF BRIDGE FREQUENCY:
- Connect current daily actions to the user's future self vision roughly once per week (not every session)
- Track this via the exercises_run array: if 'future_self_bridge' has been run in the last 5 sessions' recent data, skip it
- When you do surface it, make it feel earned, not scripted

RETURN JSON EXACTLY (no markdown, no extra keys):
{
  "assistant_message": "your message (2-3 sentences, one question)",
  "chips": [{"label": "string", "value": "string"}] | null,
  "stage_advance": false,
  "new_stage": "wins|commitment_checkin|honest|tomorrow|close|complete" | null,
  "extracted_data": {
    "mood": null,
    "win_text": null,
    "miss_text": null,
    "blocker_tags": [],
    "tomorrow_commitment": null,
    "self_hype_message": null,
    "depth_insight": null,
    "goal_id_referenced": null,  // REQUIRED when goal_why_insight is set — without this the why is silently discarded
    "goal_why_insight": null,
    "goal_why_action": null,
    "goal_why_replace_index": null,
    "goal_vision_fragment": null,
    "goal_depth_insight": null,
    "goal_suggestion": null,
    "goal_commitment_why": false
  },
  "exercise_run": "none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement|depth_probe",
  "checklist_updates": {"wins": false, "honest": false, "plan": false, "identity": false},
  "wins_asked_for_more": false,
  "honest_depth": false,
  "commitment_checkin_done": false,
  "show_goal_chips": false,
  "follow_up_queued": false,
  "follow_up_triggered": false,
  "is_session_complete": false,
  "directive_completed": null,
  "progress_event_surfaced": null
}

Set "directive_completed" to the id of the directive you executed this message (from active_directive.id in context) when you have fully delivered the directive's intended coaching action in your response, or null if you did not act on it. Only mark one directive as completed per message.`;

// ── Per-exercise coach instructions (injected only when that exercise is selected) ──

const EXERCISE_PROMPTS = {
  gratitude_anchor: `gratitude_anchor: "Name one thing from today that's still working, even if it's small." → Reflect back + connect to identity. Chips: ["Still has momentum 💪","Small but real ✅","Hard to find one 😔"]`,
  why_reconnect: `why_reconnect: "You told me this matters because [actual why]. Does that still feel true?" → If yes: "So what's getting between you and that?" If no: "What changed?"`,
  evidence_audit: `evidence_audit: "Name three things you've done in the last 30 days that the version of you who's failing wouldn't have done."`,
  implementation_intention: `implementation_intention: "Not what you want to do — when exactly, day and time, and what's the first 2-minute action." Push back if vague. Store as tomorrow_commitment. STOP once specific.`,
  values_clarification: `values_clarification: "If no one was watching and there were no consequences — what would you actually spend your time on?" → "What does that tell you about what actually matters?"`,
  future_self_bridge: `future_self_bridge: "You told me in a year you want to be [actual future_self]. What would that version of you say about tonight?" → "What's one decision right now that moves toward that?"`,
  ownership_reframe: `ownership_reframe: "What was the part that was in your control?" → If ownership: "That's the only part that matters. So what do you do with that?"`,
  triage_one_thing: `triage_one_thing: "Out of everything you're carrying — what's the ONE thing that actually matters most?" → "What's one move on that one thing?"`,
  identity_reinforcement: `identity_reinforcement: Fill in their ACTUAL win/action (never use placeholders). "That's a pattern, not a one-off. What does [their specific action] say about who you're becoming?" Then: "You told me you're someone who [their actual identity_statement]. Tonight proves it." Run ONCE per session only.`,
  depth_probe: `depth_probe (use naturally mid-conversation, not as a named exercise):
  Triggered when: user gives a surface answer to a meaningful question, or a pattern appears
  Examples: "Why do you think you keep coming back to that?" / "What's the story you're telling yourself about [X]?" / "What would have to be true about you for that to keep happening?"
  After a depth answer: sit with it. Reflect back what you heard. Then one forward question.`,
};

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
    morning: "Good morning — let's start with where you're at.",
    afternoon: 'Hey, taking a moment this afternoon to reflect.',
    evening: "Good evening — let's talk about today.",
    night: "Hey, it's getting late. Let's do a quick reflection before you sleep.",
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

function deriveStageHint(sessionState, classifierChecklist) {
  const stage = sessionState.current_stage || 'wins';
  const cl = { ...(sessionState.checklist || {}), ...(classifierChecklist || {}) };
  const hasPlan = !!sessionState.tomorrow_commitment;
  const hasYesterdayCommitment = !!sessionState.yesterday_commitment;

  // wins → commitment_checkin (only when there's a yesterday commitment)
  if (stage === 'wins' && cl.wins && sessionState.wins_asked_for_more === true && hasYesterdayCommitment) return 'commitment_checkin';
  // wins → honest (skip commitment_checkin when there's no yesterday commitment)
  if (stage === 'wins' && cl.wins && sessionState.wins_asked_for_more === true && !hasYesterdayCommitment) return 'honest';
  // commitment_checkin → honest (always — the tone of honest is set by AI based on what they said)
  if (stage === 'commitment_checkin' && sessionState.commitment_checkin_done === true) return 'honest';
  // honest → tomorrow
  if (stage === 'honest' && cl.honest && sessionState.honest_depth === true) return 'tomorrow';
  // tomorrow → close
  if (stage === 'tomorrow' && hasPlan) return 'close';
  // close → complete
  if (stage === 'close' && cl.identity && hasPlan) return 'complete';
  return null;
}

// ── Parallel context loaders (all fail silently) ──────────────────────────────

async function loadFollowUpQueue(userId, currentSignals = [], clientDate) {
  try {
    const { data } = await supabase
      .from('follow_up_queue')
      .select('id, context, question, trigger_condition, check_back_after')
      .eq('user_id', userId)
      .eq('triggered', false)
      .is('resolved_at', null);
    if (!data || data.length === 0) return [];
    const todayStr = today(clientDate);
    return data.filter((item) => {
      if (item.check_back_after <= todayStr) return true;
      if (item.trigger_condition && currentSignals.includes(item.trigger_condition)) return true;
      return false;
    });
  } catch (_e) { return []; }
}

async function loadCommitmentStats(userId, clientDate) {
  try {
    const todayStr = today(clientDate);

    // Fetch last 14 days of sessions for follow-through computation
    const { data: sessions14 } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
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

    return { rate7, trajectory, kept7: kept, total7: total };
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
      .select('date, wins, misses, tomorrow_commitment, current_stage, checklist, mood_end_of_day, summary, blocker_tags')
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
      .select('id, title, category, whys, vision_snapshot, depth_insights, last_mentioned_at, suggested_next_action')
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

    const { data: logs } = await supabase
      .from('goal_commitment_log')
      .select('goal_id, date, kept')
      .eq('user_id', userId)
      .gte('date', sinceDate)
      .lte('date', todayStr)
      .not('kept', 'is', null);

    if (!logs || logs.length === 0) return [];

    // Group by goal_id
    const byGoal = {};
    for (const log of logs) {
      const gid = log.goal_id || '__unlinked__';
      if (!byGoal[gid]) byGoal[gid] = { kept: 0, total: 0, dates: [] };
      byGoal[gid].total++;
      if (log.kept) byGoal[gid].kept++;
      byGoal[gid].dates.push(log.date);
    }

    return Object.entries(byGoal).map(([goalId, stats]) => {
      const recentLogs = logs.filter(
        (l) => (l.goal_id || '__unlinked__') === goalId && l.date > midpoint
      );
      const priorLogs = logs.filter(
        (l) => (l.goal_id || '__unlinked__') === goalId && l.date <= midpoint
      );
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
        rate_last_14: stats.total >= MIN_EVALUABLE_COMMITMENTS ? stats.kept / stats.total : null,
        trajectory,
        kept_last_14: stats.kept,
        total_last_14: stats.total,
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
  const { rate_last_14, trajectory } = goalStats;
  const daysSilent = goal.days_since_mentioned ?? 999;

  if (rate_last_14 >= MOTIVATION_STRONG_THRESHOLD && trajectory !== 'declining') return 'strong';
  if (rate_last_14 >= MOTIVATION_MEDIUM_THRESHOLD && trajectory !== 'declining') return 'medium';
  if (trajectory === 'declining' || (rate_last_14 < MOTIVATION_MEDIUM_THRESHOLD && goalStats.total_last_14 >= MIN_SAMPLES_FOR_LOW_SIGNAL)) {
    if (daysSilent >= DAYS_SILENT_FOR_STRUGGLING) return 'struggling';
    return 'low';
  }
  return 'medium';
}

// ── Goal commitment evaluation (fire-and-forget at session start) ─────────────

async function runGoalCommitmentEvaluation(userId, clientDate) {
  // Runs inline — no HTTP round-trip. Fire-and-forget: never awaited.
  try {
    const yesterday = localDate(-1, clientDate);
    const twoDaysAgo = localDate(-2, clientDate);
    const now = new Date().toISOString();

    // Check if a completed session exists for clientDate (today)
    const { data: completedSession } = await supabase
      .from('reflection_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('date', clientDate)
      .eq('is_complete', true)
      .maybeSingle();

    // Mark yesterday's pending commitments as kept if today's session is already complete
    if (completedSession) {
      await supabase
        .from('goal_commitment_log')
        .update({ kept: true, evaluated_at: now })
        .eq('user_id', userId)
        .eq('date', yesterday)
        .is('kept', null);
    }

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

async function markExerciseExplained(userId, exerciseName, currentExplained = []) {
  try {
    if (currentExplained.includes(exerciseName)) return;
    await supabase.from('user_profiles')
      .update({ exercises_explained: [...currentExplained, exerciseName] }).eq('id', userId);
  } catch (_e) {}
}

async function queueFollowUp(userId, sessionId, { context, question, check_back_after, trigger_condition }, clientDate) {
  try {
    await supabase.from('follow_up_queue').insert({
      user_id: userId, session_id: sessionId, context, question,
      check_back_after: check_back_after || daysFromNow(3, clientDate),
      trigger_condition: trigger_condition || null,
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

// ── Session Directive Queue ───────────────────────────────────────────────────

/**
 * Builds a prioritized array of coaching directive objects based on current session state.
 * Each directive maps to exactly one conditional instruction from the original instructions[] array.
 * Returns only directives whose condition is currently true, not already completed, and not already queued.
 */
function buildDirectiveQueue({
  preSessionState, isMemoryMode, followUpQueue, growthMarkers,
  intentData, suggestedPractice, depthProbeNeeded, sessionState,
  profile, commitmentStats, yesterdayCommitment,
  goalMissingWhy, messageCount, sessionReadyToClose, forceClose,
  identityMissing, honestMissing, suggestedNextStage, sessionExercisesRun,
  userInsights, recentSessions, effectiveConsecutiveExcuses,
  currentDirectiveQueue, completedDirectives,
}) {
  const currentStage = sessionState.current_stage || 'wins';
  const allDirectives = [];
  const exercisesExplained = Array.isArray(profile?.exercises_explained) ? profile.exercises_explained : [];
  const isFirstTimeExercise = suggestedPractice !== 'none' && !exercisesExplained.includes(suggestedPractice);

  // ── cold_start_opener ──────────────────────────────────────────────────
  if (preSessionState?.cold_start) {
    allDirectives.push({
      id: 'cold_start_opener',
      instruction: `COLD START (${preSessionState.days_since_last_session ?? 'many'} days away): Do NOT open generically. Reference the gap directly and warmly. ${preSessionState.returning_user_context ? `Last session context: "${preSessionState.returning_user_context}".` : ''} Open with something specific that shows you remember them and have been thinking about where they left off.`,
      priority: 1,
      preferred_stage: 'wins',
      fire_next_session: false,
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
    });
  }

  // ── follow_up_surface ──────────────────────────────────────────────────
  if (followUpQueue) {
    allDirectives.push({
      id: 'follow_up_surface',
      instruction: 'PRIORITY: Surface follow_up_due question first.',
      priority: 1,
      preferred_stage: 'any',
      fire_next_session: true,
      followup_question: 'How did things go with what you were working through last time — has anything shifted since then?',
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
    });
  }

  // ── run_exercise ───────────────────────────────────────────────────────
  if (suggestedPractice !== 'none') {
    allDirectives.push({
      id: 'run_exercise',
      instruction: `RUN: ${suggestedPractice}. first_time=${isFirstTimeExercise}. Fill ALL placeholders with user's actual words — never output [bracket placeholders]. Set exercise_run="${suggestedPractice}".`,
      priority: 2,
      preferred_stage: 'any',
      fire_next_session: false,
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
    });
  }

  // ── wins_callback ──────────────────────────────────────────────────────
  if (Array.isArray(sessionState.wins) && sessionState.wins.length > 0 && currentStage !== 'wins') {
    const winsText = sessionState.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean).join(', ');
    allDirectives.push({
      id: 'wins_callback',
      instruction: `CALLBACK: The user mentioned these wins earlier: ${winsText}. If relevant, reference these by name when asking about follow-through or identity. Never re-ask what you already know.`,
      priority: 3,
      preferred_stage: 'honest',
      fire_next_session: false,
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
      });
    }
  }

  // ── why_missing ────────────────────────────────────────────────────────
  if (goalMissingWhy && !sessionReadyToClose && !forceClose) {
    allDirectives.push({
      id: 'why_missing',
      instruction: `WHY MISSING (HIGHEST PRIORITY): The goal "${goalMissingWhy.title}" (id: ${goalMissingWhy.id}) has never had a why captured. If any natural moment exists this session — especially during wins, honest, or when this goal comes up — ask what makes it actually matter. When you ask it, briefly frame why it matters: e.g. "I've never actually heard what makes ${goalMissingWhy.title} real for you — not the goal itself, but what's underneath it" or "The reason I'm asking is that the why is what keeps the goal alive when the motivation dips." One sentence of framing, then the question. Use their words and context, not generic language. When they answer, you MUST set extracted_data.goal_why_insight to their response, extracted_data.goal_why_action to "add", and extracted_data.goal_id_referenced to exactly "${goalMissingWhy.id}". Do not skip setting goal_id_referenced — without it the why is silently lost. Don't force it if the goal hasn't come up.`,
      priority: 1,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: `I wanted to ask — what makes ${goalMissingWhy.title} actually matter to you? Not the goal itself, but what's underneath it.`,
    });
  }

  // ── honest_missing ─────────────────────────────────────────────────────
  if (honestMissing) {
    const patternHint = userInsights.length > 0
      ? `Their recurring pattern is "${userInsights[0].pattern_label}" — if it came up today, help them name it. E.g. "Did ${userInsights[0].pattern_label.replace(/_/g, ' ')} show up anywhere today?" or "Was there a moment where you held back and you're not sure why?"`
      : `E.g. "Where did you feel like you weren't fully showing up today?" or "Is there a moment from today that's still sitting with you?" or "What part of today are you least proud of — not what you'd fix, just what happened?"`;
    allDirectives.push({
      id: 'honest_missing',
      instruction: `HONEST MISSING: Gently probe for a miss or honest moment with self-awareness questions. ${patternHint} Goal is self-awareness about TODAY, not action planning. Do NOT ask "what would you do differently" — that belongs in tomorrow. Weave it naturally. Once a miss is named, ask the one question that goes underneath it — what was actually happening underneath that surface behavior, not just what they did or didn't do. Do NOT set honest_depth: true until the user has genuinely answered the underneath layer. A surface answer is not enough. Evaluate qualitatively: is this a real answer about why it happened — the actual reason, the emotional truth, the internal conflict? If yes → set honest_depth: true. If no → ask the one question that goes there. When probing for the honest moment, you can briefly frame what this part of the session is for — e.g. "Before we talk about tomorrow, I want to make sure we've gone there — the part of today that's worth being honest about" or "This is the part most people skip, but it's usually the most useful." Keep it to one sentence — then ask.`,
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: 'Before we close — was there a moment from last time that\'s still sitting with you, something you didn\'t fully land on?',
    });
  }

  // ── commitment_checkin ─────────────────────────────────────────────────
  if (currentStage === 'commitment_checkin' && !sessionState.commitment_checkin_done) {
    const yc = sessionState.yesterday_commitment || yesterdayCommitment;
    if (yc) {
      allDirectives.push({
        id: 'commitment_checkin',
        instruction: `## STAGE: COMMITMENT CHECK-IN\nYou are here only when session.current_stage === 'commitment_checkin'.\n- Reference yesterday's exact commitment text: "${yc}"\n- Ask exactly ONE question about how it went. Use their words, not generic language.\n- Before asking, you can briefly frame why the check-in matters: e.g. "I want to start there — because what happened with yesterday's plan tells us a lot about what to focus on tonight" or "Starting here because following through on what we said matters more than what we plan next." One sentence max. Then ask.\n- If they kept it → acknowledge the follow-through warmly and absorb it into momentum. Set commitment_checkin_done: true and advance to honest stage.\n- If they missed it or it was partial → their answer IS the honest stage opener. Do not probe further here. Set commitment_checkin_done: true and advance to honest stage. The honest exploration begins from this point.\n- Never ask twice. One exchange only. Always set commitment_checkin_done: true after their response, regardless of outcome.`,
        priority: 1,
        preferred_stage: 'commitment_checkin',
        fire_next_session: false,
      });
    }
  }

  // ── identity_missing ───────────────────────────────────────────────────
  if (identityMissing && !sessionReadyToClose) {
    allDirectives.push({
      id: 'identity_missing',
      instruction: `IDENTITY MISSING: Find a natural moment to ask what their actions say about who they're becoming. When you ask it, you can briefly frame why: e.g. "I always want to end here — because the actions matter less than what they say about who you are" or "This is the part I care most about." One short phrase, then ask: "What does [their action] say about who you're becoming?"`,
      priority: 2,
      preferred_stage: 'close',
      fire_next_session: true,
      followup_question: 'I want to end on something important — what does how you showed up last time say about who you\'re becoming?',
    });
  }

  // ── commitment_quality ─────────────────────────────────────────────────
  if (commitmentStats) {
    const { rate7, trajectory: traj, total7 } = commitmentStats;
    const commitmentStatsForInstruction = traj === 'declining' || (rate7 < 0.5 && total7 >= 5);
    if (commitmentStatsForInstruction) {
      const ratePercent = Math.round(rate7 * 100);
      allDirectives.push({
        id: 'commitment_quality',
        instruction: `COMMITMENT QUALITY: Follow-through rate is ${ratePercent}% (${commitmentStats.kept7}/${total7} last 7 days), trajectory is ${traj}. When the user is forming their commitment, gently suggest they scale it back to something they can absolutely guarantee. Say something like: "Given where you're at, let's make this something you can 100% do — we can push the intensity later. What's one small thing you'll actually show up for?" Do NOT lecture. Say it once, warmly, then let them commit to what they want. When nudging for a more specific commitment, briefly frame why specificity matters: e.g. "The reason I'm pushing on this is that vague plans are easy to talk yourself out of" or "Specific commitments are what actually stick — when and how matters." One sentence, then the question.`,
        priority: 2,
        preferred_stage: 'tomorrow',
        fire_next_session: false,
      });
    }
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
      });
    }
  }

  // ── pattern_awareness ──────────────────────────────────────────────────
  if (userInsights.length > 0 && messageCount >= 2 && (userInsights[0].sessions_synthesized_from || 0) >= 2) {
    const topInsight = userInsights[0];
    allDirectives.push({
      id: 'pattern_awareness',
      instruction: `PATTERN AWARENESS: The user's most recurring pattern is "${topInsight.pattern_label}" (${topInsight.sessions_synthesized_from || 0}x). If they say or do something that looks like this pattern — even obliquely — ask a question that helps them SEE it, not name it for them. Never say "I notice you keep doing X" or "this sounds like your ${topInsight.pattern_label} pattern". Instead, ask something like: "What's making it hard to just ship it as-is?" or "You said you'd do this yesterday — what happened between then and now?" The goal is to surface the pattern through their own answer, not your observation. Use naturally. Once per session max. Do NOT interrupt a good moment to force it in. When you name it, briefly frame why noticing patterns matters: e.g. "I keep seeing this come up — and I think it's worth naming because patterns don't change until you see them" or "This is something I've noticed across a few sessions." One sentence, then surface the pattern.`,
      priority: 2,
      preferred_stage: 'honest',
      fire_next_session: true,
      followup_question: 'I\'ve been thinking about something that\'s shown up a few times — I want to check in on whether you\'re noticing it too.',
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
        });
      }
    }
  }

  // ── stage_hint ─────────────────────────────────────────────────────────
  if (suggestedNextStage && !isMemoryMode) {
    allDirectives.push({
      id: 'stage_hint',
      instruction: `STAGE HINT: Ready to move to "${suggestedNextStage}". Transition naturally if conversation supports it — use a soft bridging phrase that signals the shift without announcing it. E.g. for wins→honest: "Okay — I want to shift for a second." For honest→tomorrow: "Alright, I've got a good picture of today. Let's talk about tomorrow." For tomorrow→close: "Good — before I let you go..." For close→complete: "That's what I needed. Tonight you..." Never announce the stage name. Set stage_advance:true, new_stage:"${suggestedNextStage}".`,
      priority: 2,
      preferred_stage: 'any',
      fire_next_session: false,
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
 */
function dispatchNextDirective(directiveQueue, currentStage) {
  if (!directiveQueue || directiveQueue.length === 0) return null;

  // First: find highest-priority directive that matches current stage
  const stageMatch = directiveQueue.find(
    d => d.priority === 1 && (d.preferred_stage === currentStage || d.preferred_stage === 'any')
  );
  if (stageMatch) return stageMatch;

  // Second: any priority-1 directive regardless of stage
  const anyP1 = directiveQueue.find(d => d.priority === 1);
  if (anyP1) return anyP1;

  // Third: priority-2 directive that matches current stage
  const p2StageMatch = directiveQueue.find(
    d => d.priority === 2 && (d.preferred_stage === currentStage || d.preferred_stage === 'any')
  );
  if (p2StageMatch) return p2StageMatch;

  // Fourth: any priority-2
  const anyP2 = directiveQueue.find(d => d.priority === 2);
  if (anyP2) return anyP2;

  // Fifth: priority-3 (opportunistic)
  return directiveQueue[0] || null;
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
  const honestMissing = !mergedChecklist.honest && !hasMissInSession && messageCount >= 4;
  const identityMissing = !mergedChecklist.identity && messageCount >= 6;
  const sessionReadyToClose = tomorrowFilled && mergedChecklist.wins && (mergedChecklist.identity || messageCount >= 10);
  const forceClose = messageCount >= 14 && tomorrowFilled && mergedChecklist.wins;
  const depthProbeNeeded = intentData?.depth_opportunity && !sessionExercisesRun.includes('depth_probe');
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
          };
        })
      : undefined,
    yesterday_commitment: yesterdayCommitment || 'none',
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
      stage: sessionState.current_stage || 'wins',
      checklist: mergedChecklist,
      tomorrow_commitment: sessionState.tomorrow_commitment || null,
      exercises_run: sessionExercisesRun,
      consecutive_excuses: consecutiveExcuses,
      message_count: messageCount,
      wins_asked_for_more: sessionState.wins_asked_for_more === true,
      honest_depth: sessionState.honest_depth === true,
      commitment_checkin_done: sessionState.commitment_checkin_done === true,
      yesterday_commitment_in_state: !!(sessionState.yesterday_commitment || yesterdayCommitment),
      session_wins_captured: Array.isArray(sessionState.wins)
        ? sessionState.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean)
        : [],
      session_misses_captured: Array.isArray(sessionState.misses)
        ? sessionState.misses.map(m => typeof m === 'string' ? m : m?.text).filter(Boolean)
        : [],
      session_blockers_captured: sessionState.blocker_tags || [],
      depth_insight_captured: sessionState.depth_insight || null,
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
    pre_session_state: preSessionState || undefined,
    instructions: [
      // ── Active directive — one queued coaching action dispatched this message ─
      activeDirective ? activeDirective.instruction : null,
      // ── Guard rails — always permanent context ────────────────────────────
      sessionExercisesRun.length > 0 ? `ALREADY RUN: ${sessionExercisesRun.join(', ')}. Do NOT repeat.` : null,
      forceClose
        ? 'FORCE CLOSE: Session has gone long. Wins + plan covered. Wrap up NOW with a warm identity statement. Set is_session_complete:true. No more questions.'
        : sessionReadyToClose
          ? `READY TO CLOSE: wins + plan covered. If tone is resolved, wrap warmly. End with an identity statement. Set is_session_complete:true. Do NOT keep drilling.`
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
  try {
    authenticatedUserId = await getAuthenticatedUserId(req);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  try {
    const {
      user_id, session_id,
      session_state = {}, history = [],
      user_message, context = {},
      intent_data: clientIntentData = null,
    } = req.body;

    // Extract client-supplied local date and timezone offset (sent by the browser)
    // client_local_date: YYYY-MM-DD string in the user's local time
    // client_tz_offset: minutes WEST of UTC (from new Date().getTimezoneOffset(), e.g. EST = 300)
    const client_local_date = context.client_local_date || null;
    const client_tz_offset = context.client_tz_offset != null ? context.client_tz_offset : null;

    if (!authenticatedUserId || !user_message) {
      return res.status(400).json({ error: 'user_id and user_message are required' });
    }

    const isInit = user_message === '__INIT__';

    // ── 1. Classify intent ────────────────────────────────────────────────
    let intentData = clientIntentData;
    if (!intentData && !isInit) {
      intentData = await classifyIntent(user_message, session_state);
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

    const [followUpQueue, growthMarkers, recentSessions, yesterdayCommitment, userProfile, activeGoalsRaw, commitmentStats, todayEarlyCommitment, goalCommitmentStats, userInsights, progressEvents] =
      await Promise.all([
        loadFollowUpQueue(authenticatedUserId, currentSignals, client_local_date),
        loadGrowthMarkers(authenticatedUserId, client_local_date),
        loadRecentSessionsSummary(authenticatedUserId),
        loadYesterdayCommitment(authenticatedUserId, client_local_date),
        loadUserProfile(authenticatedUserId),
        loadActiveGoals(authenticatedUserId),
        loadCommitmentStats(authenticatedUserId, client_local_date),
        loadTodayEarlyCommitment(authenticatedUserId, client_local_date),
        loadGoalCommitmentStats(authenticatedUserId, client_local_date),
        loadUserInsights(authenticatedUserId),
        loadProgressEvents(authenticatedUserId),
      ]);

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
      ? computePreSessionState(client_local_date, { recentSessions, followUpQueue, growthMarkers, userInsights })
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
      exercises_explained: userProfile?.exercises_explained || [],
      values: userProfile?.values || [],
      short_term_state: userProfile?.short_term_state || null,
      long_term_patterns: userProfile?.long_term_patterns || [],
      growth_areas: userProfile?.growth_areas || [],
      strengths: userProfile?.strengths || [],
      consecutive_excuse_sessions: userProfile?.consecutive_excuse_sessions || 0,
      last_session_completed_at: userProfile?.last_session_completed_at || null,
    };

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
    const dueFollowUp = followUpQueue.length > 0 ? followUpQueue[0] : null;
    const dueGrowthMarker = growthMarkers.length > 0 ? growthMarkers[0] : null;

    const followUpInstruction = dueFollowUp
      ? `\n\nFOLLOW-UP QUEUE: A follow-up question was queued from a previous session. Context: "${dueFollowUp.context}". Question to surface: "${dueFollowUp.question}". Weave this naturally into the session opening — do not announce it as a follow-up, just bring it up as if continuing the thread.`
      : '';

    const growthMarkerInstruction = dueGrowthMarker
      ? `\n\nGROWTH MARKER CHECK-IN: 14 days ago you were working through the theme "${dueGrowthMarker.theme}". ${dueGrowthMarker.check_in_message ? `Original note: "${dueGrowthMarker.check_in_message}".` : ''} Surface this naturally in the session — ask how it's going with that theme. Do not announce it as a scheduled check-in.`
      : '';

    // ── 6. Exercise cooldown + smart blocks ───────────────────────────────
    const sessionExercisesRun = Array.isArray(session_state.exercises_run) ? session_state.exercises_run : [];
    let suggestedExercise = intentData?.suggested_exercise || 'none';

    if (suggestedExercise !== 'none' && sessionExercisesRun.includes(suggestedExercise)) {
      suggestedExercise = 'none';
    }
    // Block implementation_intention if plan already captured
    if (suggestedExercise === 'implementation_intention' && session_state.tomorrow_commitment) {
      suggestedExercise = 'none';
    }
    // depth_probe: allow once per session naturally; block if already run
    if (suggestedExercise === 'depth_probe' && sessionExercisesRun.includes('depth_probe')) {
      suggestedExercise = 'none';
    }

    // ── 6b. Stage hint ─────────────────────────────────────────────────
    const messageCount = history.length;
    const suggestedNextStage = deriveStageHint(session_state, intentData?.checklist_content);

    // ── 8. Build compact context block ───────────────────────────────────
    const exercisesExplained = Array.isArray(profile.exercises_explained) ? profile.exercises_explained : [];
    const isFirstTimeExercise = suggestedExercise !== 'none' && !exercisesExplained.includes(suggestedExercise);

    // ── 8b. Memory search for question/advice/memory_query/reflective intents ────────
    const isMemoryMode = ['question', 'advice_request', 'memory_query'].includes(intentData?.intent);
    const shouldSearchMemories = isMemoryMode || intentData?.emotional_state === 'reflective';
    let relevantMemories = [];
    if (!isInit && shouldSearchMemories) {
      relevantMemories = await searchRelevantMemories(authenticatedUserId, user_message, 3);
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
      return false;
    });

    // ── Directive Queue ───────────────────────────────────────────────────
    const currentDirectiveQueue = Array.isArray(session_state.directive_queue) ? session_state.directive_queue : [];
    const completedDirectives = Array.isArray(session_state.completed_directives) ? session_state.completed_directives : [];

    // Derive values needed for directive conditions
    const mergedChecklist = { ...(session_state.checklist || {}), ...(intentData?.checklist_content || {}) };
    const tomorrowFilled = !!session_state.tomorrow_commitment;
    const hasMissInSession = Array.isArray(session_state.misses) && session_state.misses.length > 0;
    const honestMissing = !mergedChecklist.honest && !hasMissInSession && messageCount >= 4;
    const identityMissing = !mergedChecklist.identity && messageCount >= 6;
    const sessionReadyToClose = tomorrowFilled && mergedChecklist.wins && (mergedChecklist.identity || messageCount >= 10);
    const forceClose = messageCount >= 14 && tomorrowFilled && mergedChecklist.wins;
    const depthProbeNeeded = !!(intentData?.depth_opportunity && !sessionExercisesRun.includes('depth_probe'));
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
      yesterdayCommitment,
      goalMissingWhy,
      messageCount,
      sessionReadyToClose,
      forceClose,
      identityMissing,
      honestMissing,
      suggestedNextStage,
      sessionExercisesRun,
      userInsights,
      recentSessions,
      effectiveConsecutiveExcuses,
      currentDirectiveQueue,
      completedDirectives,
    });

    // Combined queue: existing pending + newly generated (no duplicates)
    const currentQueueIds = new Set(currentDirectiveQueue.map(d => d.id));
    const combinedDirectiveQueue = [
      ...currentDirectiveQueue,
      ...newDirectives.filter(d => !currentQueueIds.has(d.id)),
    ];

    const currentStage = session_state.current_stage || 'wins';
    // isInit messages skip directive dispatch — init has its own fixed opener logic
    const activeDirective = isInit ? null : dispatchNextDirective(combinedDirectiveQueue, currentStage);

    const contextBlock = buildSessionContext({
      profile,
      goalsContext,
      userInsights,
      sessionState: session_state,
      recentSessions,
      commitmentStats,
      followUpQueue: dueFollowUp,
      growthMarkers: dueGrowthMarker,
      suggestedPractice: suggestedExercise,
      isFirstTimeExercise,
      exercisesExplained,
      intentData,
      preSessionState,
      yesterdayCommitment,
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
      streak: context.reflection_streak || context.streak || 0,
      daysSinceLastSession,
      activeDirective,
      directiveQueue: combinedDirectiveQueue,
      completedDirectives,
      progressEvents,
    });

    // ── 9. Build messages ─────────────────────────────────────────────────
    const exerciseInstruction = suggestedExercise !== 'none' && EXERCISE_PROMPTS[suggestedExercise]
      ? `\n\nEXERCISE WORKFLOW:\n${EXERCISE_PROMPTS[suggestedExercise]}`
      : '';
    const effectiveSystemPrompt = SYSTEM_PROMPT + followUpInstruction + growthMarkerInstruction + exerciseInstruction;
    const messages = [{ role: 'system', content: effectiveSystemPrompt }, contextBlock, ...history.slice(-18)];

    if (!isInit) {
      messages.push({ role: 'user', content: user_message });
    } else {
      const stage = session_state?.current_stage || 'wins';
      const streak = context.reflection_streak || context.streak || 0;
      messages.push({
        role: 'user',
        content: `Open the ${stage} stage of tonight's reflection. Greeting: "${getTimeGreeting(client_tz_offset)}". ${
          sameDayCommitment
            ? `This morning they committed to: "${sameDayCommitment.commitment}". Open by checking in on how that went today before starting the reflection. Then offer mood chips.`
            : 'Open with a warm greeting and mood chips.'
        } ${streak > 1 ? `${streak}-night streak — acknowledge briefly.` : ''} Start with mood chips: [{"label":"Proud 🔥","value":"proud"},{"label":"Grateful 🙏","value":"grateful"},{"label":"Motivated 💪","value":"motivated"},{"label":"Okay 😐","value":"okay"},{"label":"Tired 😴","value":"tired"},{"label":"Stressed 😤","value":"stressed"}]`,
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
    result.show_goal_chips = result.show_goal_chips === true;

    // Mark a progress event as surfaced if the AI referenced it
    if (result.progress_event_surfaced && typeof result.progress_event_surfaced === 'string') {
      markProgressEventSurfaced(result.progress_event_surfaced); // fire-and-forget
    }

    // Safety guard — prevent hallucinated stage values from GPT
    const VALID_STAGES = ['wins', 'commitment_checkin', 'honest', 'tomorrow', 'close', 'complete'];
    if (result.new_stage && !VALID_STAGES.includes(result.new_stage)) {
      result.new_stage = null;
      result.stage_advance = false;
    }

    // Safety strip — never re-run a blocked exercise
    if (result.exercise_run !== 'none' && sessionExercisesRun.includes(result.exercise_run)) {
      result.exercise_run = 'none';
    }

    // Merge classifier checklist detections
    if (intentData?.checklist_content) {
      Object.keys(intentData.checklist_content).forEach((key) => {
        if (intentData.checklist_content[key]) result.checklist_updates[key] = true;
      });
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

    // ── 11. Post-response DB writes ───────────────────────────────────────
    const dbPromises = [];

    if (session_id && Object.values(result.checklist_updates).some(Boolean)) {
      dbPromises.push(updateSessionChecklist(session_id, result.checklist_updates));
    }
    if (session_id) {
      dbPromises.push(updateSessionExercise(session_id, result.exercise_run, consecutiveExcuses));
    }
    if (result.exercise_run && result.exercise_run !== 'none' && isFirstTimeExercise) {
      dbPromises.push(markExerciseExplained(authenticatedUserId, result.exercise_run, exercisesExplained));
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

    if (session_id && (result.stage_advance || result.extracted_data || result.is_session_complete || result.commitment_checkin_done)) {
      const updates = {};
      if (result.stage_advance && result.new_stage) updates.current_stage = result.new_stage;
      if (result.extracted_data?.mood) updates.mood_end_of_day = result.extracted_data.mood;
      if (result.extracted_data?.tomorrow_commitment) {
        updates.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
        // Only set commitment_made_at when first setting the commitment
        if (!session_state.tomorrow_commitment) {
          updates.commitment_made_at = new Date().toISOString();
        }
      }
      if (result.extracted_data?.self_hype_message) updates.self_hype_message = result.extracted_data.self_hype_message;
      if (result.commitment_checkin_done) updates.commitment_checkin_done = true;
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
      if (result.is_session_complete && client_local_date) {
        dbPromises.push(
          supabase.from('user_profiles')
            .update({ last_session_completed_at: today(client_local_date) })
            .eq('id', authenticatedUserId).then(() => {}).catch(() => {})
        );
      }
    }

    // Extract goal-linked commitments when tomorrow_commitment is first set
    if (result.extracted_data?.tomorrow_commitment && !session_state.tomorrow_commitment && activeGoals.length > 0) {
      (async () => {
        try {
          const commitmentText = result.extracted_data.tomorrow_commitment;
          const goalList = activeGoals.map((g) => ({ id: g.id, title: g.title, category: g.category }));
          const extraction = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You extract goal links from a commitment string. Split the commitment into individual commitments if multiple are present (e.g. "go to gym and work on app" → two items). For each, match to the most relevant goal_id from the goals list, or null if none fit clearly.
Return ONLY valid JSON: { "items": [{ "goal_id": "uuid or null", "text": "commitment fragment", "confidence": "high|medium|low" }] }
Only link when genuinely relevant. Do not force links. Multiple items can have the same goal_id. goal_id must be exactly from the provided list or null.`,
              },
              {
                role: 'user',
                content: JSON.stringify({ commitment: commitmentText, goals: goalList }),
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: 300,
          });
          const extracted = JSON.parse(extraction.choices[0].message.content);
          const items = Array.isArray(extracted.items) ? extracted.items : [];
          const clientToday = today(client_local_date);
          for (const item of items) {
            const goalId = item.goal_id && activeGoals.some((g) => g.id === item.goal_id) ? item.goal_id : null;
            await supabase.from('goal_commitment_log').insert({
              user_id: authenticatedUserId,
              session_id: session_id || null,
              goal_id: goalId,
              commitment_text: item.text || commitmentText,
              date: clientToday,
              kept: null,
            });
          }
          // If no items extracted or all null, log one unlinked entry
          if (items.length === 0) {
            await supabase.from('goal_commitment_log').insert({
              user_id: authenticatedUserId,
              session_id: session_id || null,
              goal_id: null,
              commitment_text: commitmentText,
              date: clientToday,
              kept: null,
            });
          }
        } catch (_e) { /* fail silently */ }
      })();
    }

    // Write wins to session row atomically (avoids read-then-write race condition)
    if (session_id && result.extracted_data?.win_text) {
      dbPromises.push(
        supabase.rpc('append_jsonb_array_item', {
          p_table: 'reflection_sessions',
          p_column: 'wins',
          p_id: session_id,
          p_item: { text: result.extracted_data.win_text },
          p_dedup_key: 'text',
        }).catch((e) => console.error('Failed to persist win to session:', e))
      );
    }

    // Write misses to session row atomically (avoids read-then-write race condition)
    if (session_id && result.extracted_data?.miss_text) {
      dbPromises.push(
        supabase.rpc('append_jsonb_array_item', {
          p_table: 'reflection_sessions',
          p_column: 'misses',
          p_id: session_id,
          p_item: { text: result.extracted_data.miss_text },
          p_dedup_key: 'text',
        }).catch((e) => console.error('Failed to persist miss to session:', e))
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
            .select('whys')
            .eq('id', goalId)
            .eq('user_id', authenticatedUserId)
            .single();

          let currentWhys = Array.isArray(goalData?.whys) ? [...goalData.whys] : [];

          if (action === 'replace' && typeof replaceIndex === 'number' && currentWhys[replaceIndex]) {
            currentWhys[replaceIndex] = newWhy;
          } else {
            // add (or default if action is null/missing)
            currentWhys.push(newWhy);
          }

          await supabase
            .from('goals')
            .update({ whys: currentWhys, last_mentioned_at: clientToday })
            .eq('id', goalId)
            .eq('user_id', authenticatedUserId);
        } catch (_e) { /* fail silently */ }
      })();
    }

    // Goal vision fragment — write to goals.vision_snapshot and update last_mentioned_at
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
      follow_up_queued: false, is_session_complete: false,
      consecutive_excuses: 0,
    });
  }
}