/**
 * api/reflection-coach.js
 *
 * PRIMARY reflection coaching endpoint.
 *
 * Pipeline per request:
 *   1. Receive body (user_id, session_id, session_state, history, user_message, context)
 *   2. Classify intent internally
 *   3. Load context in parallel: follow_up_queue, growth_markers, reflection_patterns,
 *      last-7-session summaries, yesterday commitment, user profile, active goals
 *   4. Decide if a queued follow-up should surface before the main response
 *   5. Build the GPT-4o prompt with all context + coaching instructions
 *   6. Call GPT-4o and parse the structured response
 *   7. Post-response DB writes — all fail silently
 *   8. Return full response shape to client
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

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
- 2-3 sentences max per message. One question only. Never dump
- Celebrate wins with genuine energy, not corporate cheerleading
- Do NOT let people off the hook — ask the follow-up question that actually matters

CORE RULES:
- NEVER validate excuses. Acknowledge frustration, pivot to what's in their control
- NEVER be a therapist. Be a coach. Forward-focused, action-oriented
- NEVER ask two questions at once
- NEVER be generic — use their actual words, goals, and why
- NEVER catastrophize or pile on when struggling
- ALWAYS connect observations back to their identity and future self
- IF a follow-up from the queue is due, surface it BEFORE anything else
- IF a growth marker check-in is due, weave it in naturally

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

METACOGNITIVE QUESTIONING PRINCIPLES:
- The most valuable question you can ask is one that makes the user realize something about themselves that they hadn't consciously noticed yet
- Ask questions that surface contradictions: "You said you want X, but you also said Y happened. What's going on there?"
- Ask questions about the gap between intention and action: "What was different about today vs. the days it did work?"
- Ask questions that name the pattern without naming it: "Is this the first time that's happened, or does this show up in other places too?"
- Ask questions about the decision moment: "At what point in the day did you decide not to do it?" — the answer usually reveals the real blocker
- When someone achieves something: "What made today different?" — not "great job!" — help them understand the mechanism so they can replicate it
- One question. Always one. Never a list. Never two questions in the same message.

DEPTH CONVERSATION: When the user is in a reflective back-and-forth ("what do you think" style exchange), allow the chain to continue naturally. Multiple consecutive "what do you think" exchanges are GOOD — do not prematurely pivot to action or next stage. Only close a depth thread when the user has reached an insight or naturally signals they want to move on. When the user answers a reflective/opinion question with their own reflection, the coach IS ALLOWED to follow up with another reflective question — do not count this as "drilling a topic".

ON THE CHECKLIST (wins / honest / plan / identity):
- These are background goals — track silently from conversation
- wins: a real win or effort was mentioned. After the FIRST win is mentioned, always follow up with an open invitation to share more: e.g. "What else went well today?" or "What's another one?" — do NOT advance to the honest stage after just one win exchange. Let the user share as many wins as they want before moving on. Set wins_asked_for_more: true in the response only after you have asked this "what else?" question at least once. If the user responds with a list of wins (e.g. "sleep, app work, boxing"), you MAY ask about multiple items from that list in the same response — this is the ONE exception to the one-question rule. Only transition to honest after the user clearly signals they are done sharing wins.
- honest: they acknowledged something they're struggling with or could improve. When the honest moment is first detected, do NOT immediately close the honest stage. Ask ONE open-ended follow-up question that invites the user to say more — e.g. "What do you think was really behind that?" or "When in the day did you notice it happening?" After the user responds to that follow-up, ask ONE open-ended "anything else?" prompt — e.g. "Anything else worth naming before we move on?" or "Is there anything else from today you want to get off your chest?" or "Anything else that's been sitting with you?" — to give them space to share more honest moments. Only after the user has responded to the "anything else?" prompt (or clearly signaled they're done) should you set honest_depth: true in the response.
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
- Briefly explain WHY (1 sentence, only first time — check exercises_explained)
- After exercise: connect result back to identity, goals, or future self
- NEVER repeat an exercise in exercises_run for this session
- implementation_intention: STOP once a specific plan is stated — one follow-up max

ANTI-EXCUSE SYSTEM (when accountability_signal === "excuse"):
Step 1 (consecutive_excuses === 1): Acknowledge without validating + pivot to control
Step 2 (consecutive_excuses >= 2): "I notice we keep landing on what you couldn't do. What could you have done differently, even with that being true?"
Step 3 (consecutive_excuses >= 3): Pull future_self. "The version of you that [future_self] doesn't live there. What would they say right now?"
Never punitive. Always warm but direct.

EXERCISE WORKFLOWS:

gratitude_anchor: "Name one thing from today that's still working, even if it's small." → Reflect back + connect to identity. Chips: ["Still has momentum 💪","Small but real ✅","Hard to find one 😔"]

why_reconnect: "You told me this matters because [actual why]. Does that still feel true?" → If yes: "So what's getting between you and that?" If no: "What changed?"

evidence_audit: "Name three things you've done in the last 30 days that the version of you who's failing wouldn't have done."

implementation_intention: "Not what you want to do — when exactly, day and time, and what's the first 2-minute action." Push back if vague. Store as tomorrow_commitment. STOP once specific.

values_clarification: "If no one was watching and there were no consequences — what would you actually spend your time on?" → "What does that tell you about what actually matters?"

future_self_bridge: "You told me in a year you want to be [actual future_self]. What would that version of you say about tonight?" → "What's one decision right now that moves toward that?"

ownership_reframe: "What was the part that was in your control?" → If ownership: "That's the only part that matters. So what do you do with that?"

triage_one_thing: "Out of everything you're carrying — what's the ONE thing that actually matters most?" → "What's one move on that one thing?"

identity_reinforcement: Fill in their ACTUAL win/action (never use placeholders). "That's a pattern, not a one-off. What does [their specific action] say about who you're becoming?" Then: "You told me you're someone who [their actual identity_statement]. Tonight proves it." Run ONCE per session only.

depth_probe (use naturally mid-conversation, not as a named exercise):
  Triggered when: user gives a surface answer to a meaningful question, or a pattern appears
  Examples: "Why do you think you keep coming back to that?" / "What's the story you're telling yourself about [X]?" / "What would have to be true about you for that to keep happening?"
  After a depth answer: sit with it. Reflect back what you heard. Then one forward question.

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

WHY-BUILDING TRIGGER (when to ask about why):
- You decide when the moment is right — there is NO fixed schedule
- Good moments: user references a goal with high energy, user is struggling with a goal and you want to reconnect them, motivation_signal is "low" or "struggling" (meaning their commitment follow-through for this goal is declining), after a miss connected to a goal, user accepts a suggested goal
- during wins, if the user's win directly connects to a tracked goal — ask if the original why still holds or has grown
- motivation_signal is derived from behavioral data — commitment follow-through rate for this goal over the last 14 days. "struggling" = declining trajectory + goal hasn't been mentioned in 7+ days. "low" = below 40% follow-through. "medium" = 40-69%. "strong" = 70%+. "unknown" = not enough data yet.
- When motivation_signal is "low" or "struggling" AND the goal comes up naturally, PRIORITIZE why-building or why_reconnect for that goal
- You can run why-building for any goal any number of times across sessions — revisiting whys is valuable, not redundant
- Bad moments: user is already doing deep honest work on something else, session is about to close, user signals they want to move on
- NEVER ask "why does this goal matter to you?" verbatim — use their context
- If they have existing whys, reference them: "You said once this was about [why]. Is that still the thing that makes it real for you — or has something shifted?"
- If they have NO whys yet: "What's the thing that makes [goal title] actually matter — not the goal itself, but what's underneath it?"

You also may have quiet_goals — goals that haven't come up in 14+ days. These are a soft permission: if a natural opening exists, one gentle check-in is fine. If there's no opening, skip entirely.

GOALS NEEDING WHY-BUILDING (goals_need_why_building):
- These goals need their "why" captured or deepened — this is the ONLY reason they appear here
- has_whys: false means this goal has never had a why articulated — this is the highest priority: get their first why before anything else
- has_whys: true means a previous why exists but it's time to revisit and deepen it — reference their existing whys and explore whether it's still true or has shifted
- If one of these goals naturally comes up in the session, make the why-building happen
- If no natural opening exists, don't force it — but create one gently if you can
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
   → Set extracted_data.goal_id_referenced to the goal's id

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
  "new_stage": "wins|honest|tomorrow|close|complete" | null,
  "extracted_data": {
    "mood": null,
    "win_text": null,
    "miss_text": null,
    "blocker_tags": [],
    "tomorrow_commitment": null,
    "self_hype_message": null,
    "depth_insight": null,
    "goal_id_referenced": null,
    "goal_why_insight": null,
    "goal_why_action": null,
    "goal_why_replace_index": null,
    "goal_vision_fragment": null,
    "goal_depth_insight": null,
    "goal_suggestion": null
  },
  "exercise_run": "none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement|depth_probe",
  "checklist_updates": {"wins": false, "honest": false, "plan": false, "identity": false},
  "wins_asked_for_more": false,
  "honest_depth": false,
  "follow_up_queued": false,
  "is_session_complete": false
}`;

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

function deriveStageHint(sessionState, classifierChecklist, messageCount) {
  const stage = sessionState.current_stage || 'wins';
  const cl = { ...(sessionState.checklist || {}), ...(classifierChecklist || {}) };
  const hasPlan = !!sessionState.tomorrow_commitment;
  if (stage === 'wins' && cl.wins && messageCount >= 4 && sessionState.wins_asked_for_more === true) return 'honest';
  if (stage === 'honest' && cl.honest && sessionState.honest_depth === true) return 'tomorrow';
  if (stage === 'tomorrow' && hasPlan) return 'close';
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

async function loadReflectionPatterns(userId, clientDate) {
  try {
    const { data } = await supabase
      .from('reflection_patterns')
      .select('label, occurrence_count, pattern_type')
      .eq('user_id', userId)
      .gte('last_seen_date', localDate(-30, clientDate))
      .order('occurrence_count', { ascending: false })
      .limit(5);
    return data || [];
  } catch (_e) { return []; }
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
      .select('full_name, display_name, bio, identity_statement, big_goal, why, future_self, life_areas, blockers, exercises_explained, values, short_term_state, long_term_patterns, growth_areas, strengths')
      .eq('id', userId)
      .maybeSingle();
    return data || null;
  } catch (_e) { return null; }
}

async function loadActiveGoals(userId) {
  try {
    const { data } = await supabase
      .from('goals')
      .select('id, title, why_it_matters, category, whys, vision_snapshot, depth_insights, last_mentioned_at, suggested_next_action')
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

// ── Classify intent ───────────────────────────────────────────────────────────

async function classifyIntent(userMessage, sessionContext = {}) {
  const CLASSIFIER_SYSTEM = `You are a message intent classifier for a nightly reflection coaching app.
Return ONLY valid JSON:
{
  "intent": "<checkin|vent|question|advice_request|memory_query|stuck|celebrate|off_topic>",
  "energy_level": "<low|medium|high>",
  "accountability_signal": "<excuse|ownership|neutral>",
  "emotional_state": "<frustrated|proud|anxious|flat|motivated|overwhelmed|reflective>",
  "depth_opportunity": <true|false>,
  "checklist_content": {"wins": false, "honest": false, "plan": false, "identity": false},
  "suggested_exercise": "<none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement|depth_probe>"
}
EXERCISE ROUTING: excuse→ownership_reframe | low+frustrated→gratitude_anchor | stuck→values_clarification | motivation vent→why_reconnect | self-doubt→evidence_audit | procrastination→implementation_intention | celebrate/proud→identity_reinforcement | overwhelmed→triage_one_thing | reflective/deep→future_self_bridge | surface answer to meaningful topic→depth_probe | memory_query→none | no signals→none
depth_opportunity=true when: user gives a surface-level or deflecting answer to something meaningful, or reveals a belief/pattern worth exploring.
CHECKLIST: wins=mentioned a real effort/win; honest=acknowledged a miss or struggle; plan=stated a specific tomorrow action; identity=made a self-identity statement.
IMPORTANT: If tomorrow_commitment is already filled, do NOT suggest implementation_intention. If exercise is in exercises_run, return "none".
ACCOUNTABILITY: excuse=blaming external | ownership=personal responsibility | neutral=factual
No markdown. No explanation.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        {
          role: 'user',
          content: `[Stage: ${sessionContext.current_stage || 'wins'}]\n[tomorrow_commitment: ${sessionContext.tomorrow_commitment || 'none'}]\n[exercises_run: ${(sessionContext.exercises_run || []).join(', ') || 'none'}]\n[depth_probe_done: ${(sessionContext.exercises_run || []).includes('depth_probe')}]\nUser message: "${userMessage}"`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 160,
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (_e) {
    return {
      intent: 'checkin',
      energy_level: 'medium',
      accountability_signal: 'neutral',
      emotional_state: 'flat',
      depth_opportunity: false,
      checklist_content: { ...DEFAULT_CHECKLIST },
      suggested_exercise: 'none',
    };
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

async function upsertBlockerPatterns(userId, blockerTags, clientDate) {
  if (!blockerTags || blockerTags.length === 0) return;
  const todayStr = today(clientDate);
  for (const tag of blockerTags) {
    try {
      const { data: existing } = await supabase
        .from('reflection_patterns').select('id, occurrence_count')
        .eq('user_id', userId).eq('pattern_type', 'blocker').eq('label', tag).maybeSingle();
      if (existing) {
        await supabase.from('reflection_patterns')
          .update({ occurrence_count: existing.occurrence_count + 1, last_seen_date: todayStr, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('reflection_patterns').insert({
          user_id: userId, pattern_type: 'blocker', label: tag,
          occurrence_count: 1, last_seen_date: todayStr, first_seen_date: todayStr,
        });
      }
    } catch (_e) {}
  }
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

async function evolveUserProfile(userId, summaryText, currentProfile, recentSessions) {
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
3. growth_areas: areas actively being worked on (max 4 strings)
4. strengths: positive traits consistently shown (max 4 strings)
5. values: core values surfaced in their language and choices (max 5 strings)
6. identity_statement_update: ONLY if a stronger more specific identity statement clearly emerged — otherwise null
7. big_goal_update: ONLY if their goal evolved or became clearer — otherwise null
8. why_update: ONLY if their why deepened or clarified — otherwise null
9. blockers_update: ONLY if new blockers clearly emerged or existing ones evolved — otherwise null. Array of strings max 5.
10. future_self_update: ONLY if the user expressed a clearer, stronger, or evolved version of their 1-year vision — otherwise null.
11. goal_updates: array of { goal_id, why_insight, why_action, why_replace_index, vision_fragment, depth_insight, last_mentioned_date } for any goals that were meaningfully discussed. Only include fields that have new content — null otherwise. Empty array if no goals were discussed.
    - why_insight: the captured why text in their actual words (or null)
    - why_action: "add" | "replace" | null (add if new distinct motivation, replace if deeper version of existing)
    - why_replace_index: 0-based index of the why to replace (only set when why_action="replace")

Rules:
- Use their actual words, not clinical language
- Only update identity_statement/big_goal/why/blockers/future_self if genuinely stronger version emerged
- Merge with existing profile — evolve, don't erase
- Keep arrays concise, quality over quantity

Return valid JSON only:
{
  "short_term_state": "...",
  "long_term_patterns": ["..."],
  "growth_areas": ["..."],
  "strengths": ["..."],
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
      max_tokens: 700,
    });

    const evolution = JSON.parse(completion.choices[0].message.content);

    const profileUpdates = {
      short_term_state: evolution.short_term_state,
      long_term_patterns: evolution.long_term_patterns,
      growth_areas: evolution.growth_areas,
      strengths: evolution.strengths,
      values: evolution.values,
      profile_updated_at: new Date().toISOString(),
    };
    if (evolution.identity_statement_update) profileUpdates.identity_statement = evolution.identity_statement_update;
    if (evolution.big_goal_update) profileUpdates.big_goal = evolution.big_goal_update;
    if (evolution.why_update) profileUpdates.why = evolution.why_update;
    if (evolution.blockers_update) profileUpdates.blockers = evolution.blockers_update;
    if (evolution.future_self_update) profileUpdates.future_self = evolution.future_self_update;

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
            .select('whys, why_it_matters')
            .eq('id', gu.goal_id)
            .eq('user_id', userId)
            .maybeSingle()
            .then(({ data }) => {
              let currentWhys = Array.isArray(data?.whys) ? [...data.whys] : [];
              if (currentWhys.length === 0 && data?.why_it_matters) {
                currentWhys = [{ text: data.why_it_matters, added_at: null, source: 'original' }];
              }
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

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!user_id || !user_message) {
      return res.status(400).json({ error: 'user_id and user_message are required' });
    }

    const isInit = user_message === '__INIT__';

    // ── 1. Classify intent ────────────────────────────────────────────────
    let intentData = clientIntentData;
    if (!intentData && !isInit) {
      intentData = await classifyIntent(user_message, session_state);
    }
    if (!intentData) {
      intentData = {
        intent: 'checkin', energy_level: 'medium',
        accountability_signal: 'neutral', emotional_state: 'flat',
        depth_opportunity: false,
        checklist_content: { ...DEFAULT_CHECKLIST }, suggested_exercise: 'none',
      };
    }

    // ── 2. Load context in parallel ───────────────────────────────────────
    const currentSignals = [intentData?.intent, intentData?.emotional_state, intentData?.accountability_signal].filter(Boolean);

    const [followUpQueue, growthMarkers, reflectionPatterns, recentSessions, yesterdayCommitment, userProfile, activeGoalsRaw, commitmentStats, todayEarlyCommitment, goalCommitmentStats] =
      await Promise.all([
        loadFollowUpQueue(user_id, currentSignals, client_local_date),
        loadGrowthMarkers(user_id, client_local_date),
        loadReflectionPatterns(user_id, client_local_date),
        loadRecentSessionsSummary(user_id),
        loadYesterdayCommitment(user_id, client_local_date),
        loadUserProfile(user_id),
        loadActiveGoals(user_id),
        loadCommitmentStats(user_id, client_local_date),
        loadTodayEarlyCommitment(user_id, client_local_date),
        loadGoalCommitmentStats(user_id, client_local_date),
      ]);

    // Attach motivation signal to each goal
    const activeGoals = activeGoalsRaw.map((g) => {
      const gStats = goalCommitmentStats.find((s) => s.goal_id === g.id) || null;
      return {
        ...g,
        motivation_signal: computeGoalMotivationSignal(gStats, g),
        commitment_stats: gStats || null,
      };
    });

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
    };

    // ── 4. Consecutive excuses ────────────────────────────────────────────
    let consecutiveExcuses = session_state.consecutive_excuses || 0;
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
    const suggestedNextStage = deriveStageHint(session_state, intentData?.checklist_content, messageCount);

    // ── 7. Session state analysis for instructions ────────────────────────
    const mergedChecklist = { ...(session_state.checklist || {}), ...(intentData?.checklist_content || {}) };
    const tomorrowFilled = !!session_state.tomorrow_commitment;
    const sessionReadyToClose = tomorrowFilled && mergedChecklist.wins && (mergedChecklist.identity || messageCount >= 10);
    const forceClose = messageCount >= 14 && tomorrowFilled && mergedChecklist.wins;
    const depthProbeNeeded = intentData?.depth_opportunity && !sessionExercisesRun.includes('depth_probe');
    const hasMissInSession = Array.isArray(session_state.misses) && session_state.misses.length > 0;
    const honestMissing = !mergedChecklist.honest && !hasMissInSession && messageCount >= 4;
    const identityMissing = !mergedChecklist.identity && messageCount >= 6;

    // ── 8. Build compact context block ───────────────────────────────────
    const exercisesExplained = Array.isArray(profile.exercises_explained) ? profile.exercises_explained : [];
    const isFirstTimeExercise = suggestedExercise !== 'none' && !exercisesExplained.includes(suggestedExercise);

    const patternsText = reflectionPatterns.length > 0
      ? reflectionPatterns.map((p) => `${p.label}(${p.occurrence_count}x)`).join('; ')
      : 'none';

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

    // ── 8b. Memory search for question/advice/memory_query/reflective intents ────────
    const isMemoryMode = ['question', 'advice_request', 'memory_query'].includes(intentData?.intent);
    const shouldSearchMemories = isMemoryMode || intentData?.emotional_state === 'reflective';
    let relevantMemories = [];
    if (!isInit && shouldSearchMemories) {
      relevantMemories = await searchRelevantMemories(user_id, user_message, 3);
    }

    const goalsContext = activeGoals.length > 0
      ? activeGoals.map((g) => {
          const obj = {
            id: g.id,
            area: g.category,
            title: g.title,
            whys: Array.isArray(g.whys) && g.whys.length > 0
              ? g.whys
              : (g.why_it_matters ? [{ text: g.why_it_matters, source: 'original' }] : []),
            vision_snapshot: g.vision_snapshot || null,
            depth_insights: g.depth_insights?.length > 0 ? g.depth_insights : null,
            suggested_next_action: g.suggested_next_action || null,
            motivation_signal: g.motivation_signal || 'unknown',
          };
          // Only include days_since_mentioned if it's meaningful (goal was tracked before)
          if (g.days_since_mentioned !== null && g.days_since_mentioned > 7) {
            obj.days_since_mentioned = g.days_since_mentioned;
          }
          return obj;
        })
      : [];

    // Quiet goals: goals that have been tracked but haven't come up recently
    // This is a soft permission to the coach — not an instruction to surface them
    const quietGoals = activeGoals
      .filter((g) => g.last_mentioned_at && g.days_since_mentioned > 14)
      .map((g) => ({
        goal_id: g.id,
        area: g.category,
        title: g.title,
        days_since_mentioned: g.days_since_mentioned,
        note: "hasn't come up recently — if a natural opening exists, one soft check-in is fine. If no opening, skip it.",
      }));

    // Goals that need why-building: goals with no whys (first-time capture) OR
    // goals where motivation_signal is low/struggling (follow-through declining)
    const goalsNeedWhyBuilding = activeGoals.filter((g) => {
      const noWhys = !Array.isArray(g.whys) || g.whys.length === 0;
      const lowMotivation = g.motivation_signal === 'low' || g.motivation_signal === 'struggling';
      return noWhys || lowMotivation;
    });

    const contextBlock = {
      role: 'user',
      content: JSON.stringify({
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
        patterns: patternsText,
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
        session: {
          stage: session_state.current_stage || 'wins',
          checklist: mergedChecklist,
          tomorrow_commitment: session_state.tomorrow_commitment || null,
          exercises_run: sessionExercisesRun,
          consecutive_excuses: consecutiveExcuses,
          message_count: messageCount,
          wins_asked_for_more: session_state.wins_asked_for_more === true,
          honest_depth: session_state.honest_depth === true,
          session_wins_captured: Array.isArray(session_state.wins)
            ? session_state.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean)
            : [],
          session_misses_captured: Array.isArray(session_state.misses)
            ? session_state.misses.map(m => typeof m === 'string' ? m : m?.text).filter(Boolean)
            : [],
          session_blockers_captured: session_state.blocker_tags || [],
          depth_insight_captured: session_state.depth_insight || null,
        },
        intent: {
          type: intentData.intent,
          energy: intentData.energy_level,
          accountability: intentData.accountability_signal,
          emotion: intentData.emotional_state,
          depth_opportunity: intentData.depth_opportunity || false,
        },
        follow_up_due: dueFollowUp ? { context: dueFollowUp.context, question: dueFollowUp.question } : null,
        growth_marker_due: dueGrowthMarker ? { theme: dueGrowthMarker.theme, msg: dueGrowthMarker.check_in_message } : null,
        exercise: { suggested: suggestedExercise, first_time: isFirstTimeExercise, explained: exercisesExplained },
        stage_hint: suggestedNextStage,
        ready_to_close: sessionReadyToClose,
        streak: context.reflection_streak || context.streak || 0,
        instructions: [
          isMemoryMode
            ? `MEMORY MODE: The user asked a question or wants advice. PAUSE the stage workflow — do NOT advance stage or update checklist. Answer their question directly using relevant_memories and their profile data. Use their actual past words and patterns. Be specific, not generic. End your response with ONE question that naturally brings them back to the ${session_state.current_stage || 'wins'} stage.`
            : null,
          dueFollowUp ? 'PRIORITY: Surface follow_up_due question first.' : null,
          dueGrowthMarker ? 'Weave in growth_marker_due check-in naturally.' : null,
          intentData?.accountability_signal === 'excuse'
            ? `ANTI-EXCUSE: consecutive_excuses=${consecutiveExcuses}. Use their specific words. Follow the protocol.`
            : null,
          suggestedExercise !== 'none'
            ? `RUN: ${suggestedExercise}. first_time=${isFirstTimeExercise}. Fill ALL placeholders with user's actual words — never output [bracket placeholders]. Set exercise_run="${suggestedExercise}".`
            : null,
          depthProbeNeeded
            ? `DEPTH OPPORTUNITY: Go deeper here. Ask WHY or surface the belief underneath. Use a depth_probe question naturally. Set exercise_run="depth_probe". Store any insight in extracted_data.depth_insight.`
            : null,
          session_state.wins?.length > 0 && Array.isArray(session_state.wins) && session_state.current_stage !== 'wins'
            ? `CALLBACK: The user mentioned these wins earlier: ${session_state.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean).join(', ')}. If relevant, reference these by name when asking about follow-through or identity. Never re-ask what you already know.`
            : null,
          session_state.depth_insight && !sessionReadyToClose
            ? `DEPTH CALLBACK: Earlier the user surfaced this insight: "${session_state.depth_insight}". If a natural moment arises (especially in 'close' stage), reflect it back to them once — e.g. "You said earlier [insight]. What does that mean for how you show up tomorrow?" Do this once only, warmly.`
            : null,
          (() => {
            const capturedWins = Array.isArray(session_state.wins)
              ? session_state.wins.map(w => typeof w === 'string' ? w : w?.text).filter(Boolean)
              : [];
            const capturedMisses = Array.isArray(session_state.misses)
              ? session_state.misses.map(m => typeof m === 'string' ? m : m?.text).filter(Boolean)
              : [];
            const capturedBlockers = Array.isArray(session_state.blocker_tags) ? session_state.blocker_tags : [];
            if (capturedWins.length === 0 && capturedMisses.length === 0 && capturedBlockers.length === 0) return null;
            return `REFERENCE WHAT THEY SAID: The user has already shared: wins=[${capturedWins.join(', ')}], misses=[${capturedMisses.join(', ')}], blockers=[${capturedBlockers.join(', ')}]. Your next question MUST reference at least one of these specifically. Never ask a generic question when you have their real words.`;
          })(),
          honestMissing
            ? `HONEST MISSING: Gently probe for a miss or honest moment with self-awareness questions. ${
                reflectionPatterns.length > 0
                  ? `Their recurring pattern is "${reflectionPatterns[0].label}" — if it came up today, help them name it. E.g. "Did ${reflectionPatterns[0].label.replace(/_/g, ' ')} show up anywhere today?" or "Was there a moment where you held back and you're not sure why?"`
                  : `E.g. "Where did you feel like you weren't fully showing up today?" or "Is there a moment from today that's still sitting with you?" or "What part of today are you least proud of — not what you'd fix, just what happened?"`
              } Goal is self-awareness about TODAY, not action planning. Do NOT ask "what would you do differently" — that belongs in tomorrow. Weave it naturally. Once a miss is named and you have asked one specific follow-up about it, ask one open "anything else?" prompt before closing the honest stage — e.g. "Anything else worth naming before we move on?" or "Is there anything else from today you want to get off your chest?" — then set honest_depth: true only after the user has responded to that prompt or clearly signaled they're done.`
            : null,
          identityMissing && !sessionReadyToClose
            ? `IDENTITY MISSING: Find a natural moment to ask what their actions say about who they're becoming. E.g. "What does [their action] say about who you're becoming?"`
            : null,
          (() => {
            // Instruction 1 — commitment quality nudge when making the commitment (tomorrow stage)
            if (!commitmentStats) return null;
            const { rate7, trajectory: traj, total7 } = commitmentStats;
            const commitmentStatsForInstruction = traj === 'declining' || (rate7 < 0.5 && total7 >= 5);
            if (!commitmentStatsForInstruction) return null;
            const ratePercent = Math.round(rate7 * 100);
            return `COMMITMENT QUALITY: Follow-through rate is ${ratePercent}% (${commitmentStats.kept7}/${total7} last 7 days), trajectory is ${traj}. When the user is forming their commitment, gently suggest they scale it back to something they can absolutely guarantee. Say something like: "Given where you're at, let's make this something you can 100% do — we can push the intensity later. What's one small thing you'll actually show up for?" Do NOT lecture. Say it once, warmly, then let them commit to what they want.`;
          })(),
          (() => {
            // Instruction 2 — progress framing during wins (only if enough recent session history)
            if (recentSessions.length < 3) return null;
            const hasWins = recentSessions.some((s) => Array.isArray(s.wins) ? s.wins.length > 0 : !!s.summary);
            if (!hasWins) return null;
            return `PROGRESS AWARENESS: You have ${recentSessions.length} recent sessions of data. If it's natural in the wins conversation, ask ONE question that helps the user notice their own growth — using only what's real in their history. E.g. if they mention finishing something, ask "Is that something you would have followed through on a month ago?" or "How does that compare to where you were when you started?" Do NOT state their progress for them. Ask the question that makes THEM see it. Only do this once per session, and only if it genuinely fits the conversation. Never fabricate history.`;
          })(),
          (() => {
            // Instruction 3 — pattern-aware metacognitive questioning
            if (reflectionPatterns.length === 0 || messageCount < 2) return null;
            const topPattern = reflectionPatterns[0];
            if (topPattern.occurrence_count < 2) return null;
            return `PATTERN AWARENESS: The user's most recurring pattern is "${topPattern.label}" (${topPattern.occurrence_count}x). If they say or do something that looks like this pattern — even obliquely — ask a question that helps them SEE it, not name it for them. Never say "I notice you keep doing X" or "this sounds like your ${topPattern.label} pattern". Instead, ask something like: "What's making it hard to just ship it as-is?" or "You said you'd do this yesterday — what happened between then and now?" The goal is to surface the pattern through their own answer, not your observation. Use naturally. Once per session max. Do NOT interrupt a good moment to force it in.`;
          })(),
          sessionExercisesRun.length > 0
            ? `ALREADY RUN: ${sessionExercisesRun.join(', ')}. Do NOT repeat.`
            : null,
          suggestedNextStage && !isMemoryMode
            ? `STAGE HINT: Ready to move to "${suggestedNextStage}". Transition naturally if conversation supports it. Set stage_advance:true, new_stage:"${suggestedNextStage}".`
            : null,
          forceClose
            ? 'FORCE CLOSE: Session has gone long. Wins + plan covered. Wrap up NOW with a warm identity statement. Set is_session_complete:true. No more questions.'
            : sessionReadyToClose
              ? `READY TO CLOSE: wins + plan covered. If tone is resolved, wrap warmly. End with an identity statement. Set is_session_complete:true. Do NOT keep drilling.`
              : null,
          'Use their actual words — never be generic.',
          'One question only. 2-3 sentences max.',
          'NEVER drill a topic already answered.',
        ].filter(Boolean),
      }),
    };

    // ── 9. Build messages ─────────────────────────────────────────────────
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, contextBlock, ...history.slice(-18)];

    if (!isInit) {
      messages.push({ role: 'user', content: user_message });
    } else {
      const stage = session_state?.current_stage || 'wins';
      const streak = context.reflection_streak || context.streak || 0;
      messages.push({
        role: 'user',
        content: `Open the ${stage} stage of tonight's reflection. Greeting: "${getTimeGreeting(client_tz_offset)}". ${
          yesterdayCommitment
            ? `Yesterday's commitment was: "${yesterdayCommitment}". Open by asking specifically how THAT went — use their exact words from the commitment. Make it personal. Then offer mood chips.`
            : sameDayCommitment
              ? `This morning they committed to: "${sameDayCommitment.commitment}". Open by checking in on how that went today before starting the reflection. Then offer mood chips.`
              : 'No commitment on record. Open with a warm greeting and mood chips.'
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
    result.wins_asked_for_more = result.wins_asked_for_more === true;
    result.honest_depth = result.honest_depth === true;

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

    // ── 11. Post-response DB writes ───────────────────────────────────────
    const dbPromises = [];

    if (session_id && Object.values(result.checklist_updates).some(Boolean)) {
      dbPromises.push(updateSessionChecklist(session_id, result.checklist_updates));
    }
    if (session_id) {
      dbPromises.push(updateSessionExercise(session_id, result.exercise_run, consecutiveExcuses));
    }
    if (result.exercise_run && result.exercise_run !== 'none' && isFirstTimeExercise) {
      dbPromises.push(markExerciseExplained(user_id, result.exercise_run, exercisesExplained));
    }
    if (dueFollowUp) {
      dbPromises.push(markFollowUpTriggered(dueFollowUp.id));
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

          await queueFollowUp(user_id, session_id, {
            context: `${result.exercise_run} exercise run during reflection`,
            question: followUpQuestion,
            check_back_after: daysFromNow(3, client_local_date),
            trigger_condition: intentData?.emotional_state,
          }, client_local_date);
        })()
      );
      dbPromises.push(
        upsertGrowthMarker(user_id, result.exercise_run, {
          exercise_run: result.exercise_run,
          check_in_message: `How has your work on ${result.exercise_run.replace(/_/g, ' ')} been going?`,
        }, client_local_date)
      );
    }

    if (session_id && (result.stage_advance || result.extracted_data || result.is_session_complete)) {
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
              user_id,
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
              user_id,
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

    if (result.extracted_data?.blocker_tags?.length) {
      dbPromises.push(upsertBlockerPatterns(user_id, result.extracted_data.blocker_tags, client_local_date));
    }

    // Write wins to session row immediately when extracted (so data survives session interruption)
    if (session_id && result.extracted_data?.win_text) {
      dbPromises.push(
        (async () => {
          try {
            const { data: current } = await supabase
              .from('reflection_sessions')
              .select('wins')
              .eq('id', session_id)
              .maybeSingle();
            const existingWins = Array.isArray(current?.wins) ? current.wins : [];
            const newWin = { text: result.extracted_data.win_text };
            const alreadyThere = existingWins.some(w => (typeof w === 'string' ? w : w?.text) === result.extracted_data.win_text);
            if (!alreadyThere) {
              await supabase
                .from('reflection_sessions')
                .update({ wins: [...existingWins, newWin], updated_at: new Date().toISOString() })
                .eq('id', session_id);
            }
          } catch (e) { console.error('Failed to persist win to session:', e); }
        })()
      );
    }

    // Write misses to session row immediately when extracted (so data survives session interruption)
    if (session_id && result.extracted_data?.miss_text) {
      dbPromises.push(
        (async () => {
          try {
            const { data: current } = await supabase
              .from('reflection_sessions')
              .select('misses')
              .eq('id', session_id)
              .maybeSingle();
            const existingMisses = Array.isArray(current?.misses) ? current.misses : [];
            const newMiss = { text: result.extracted_data.miss_text };
            const alreadyThere = existingMisses.some(m => (typeof m === 'string' ? m : m?.text) === result.extracted_data.miss_text);
            if (!alreadyThere) {
              await supabase
                .from('reflection_sessions')
                .update({ misses: [...existingMisses, newMiss], updated_at: new Date().toISOString() })
                .eq('id', session_id);
            }
          } catch (e) { console.error('Failed to persist miss to session:', e); }
        })()
      );
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
        source: 'reflection_session',
        motivation_signal: null,  // computed behaviorally, not by AI extraction
        session_id: session_id || null,
      };

      (async () => {
        try {
          const { data: goalData } = await supabase
            .from('goals')
            .select('whys, why_it_matters')
            .eq('id', goalId)
            .eq('user_id', user_id)
            .single();

          let currentWhys = Array.isArray(goalData?.whys) ? [...goalData.whys] : [];

          // Seed from original why if empty
          if (currentWhys.length === 0 && goalData?.why_it_matters) {
            currentWhys = [{ text: goalData.why_it_matters, added_at: null, source: 'original' }];
          }

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
            .eq('user_id', user_id);
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
        .eq('user_id', user_id)
        .then(() => {}).catch(() => {});
    }

    // Goal depth insight — append to goals.depth_insights array
    if (result.extracted_data?.goal_depth_insight && result.extracted_data?.goal_id_referenced) {
      const goalId = result.extracted_data.goal_id_referenced;
      supabase
        .from('goals')
        .select('depth_insights')
        .eq('id', goalId)
        .eq('user_id', user_id)
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
            .eq('user_id', user_id);
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
        queueFollowUp(user_id, session_id, {
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
        .eq('user_id', user_id)
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
          await evolveUserProfile(user_id, summaryText, userProfile, recentSessions);

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
                await queueFollowUp(user_id, session_id, {
                  context: followUpData.context || 'Auto-queued from shallow session detector',
                  question: followUpData.question,
                  check_back_after: daysFromNow(1, client_local_date),
                  trigger_condition: null,
                }, client_local_date);
              }
            } catch (_e) { /* fail silently */ }
          }

          // Evaluate yesterday's goal commitments now that this session is complete
          try {
            const yesterday = localDate(-1, client_local_date);
            const { data: pendingLogs } = await supabase
              .from('goal_commitment_log')
              .select('id')
              .eq('user_id', user_id)
              .eq('date', yesterday)
              .is('kept', null);
            if (pendingLogs && pendingLogs.length > 0) {
              await supabase
                .from('goal_commitment_log')
                .update({ kept: true, evaluated_at: new Date().toISOString() })
                .eq('user_id', user_id)
                .eq('date', yesterday)
                .is('kept', null);
            }
          } catch (_e) { /* fail silently */ }

          // Mark commitments from 2+ days ago that are still null as missed
          try {
            const twoDaysAgo = localDate(-2, client_local_date);
            await supabase
              .from('goal_commitment_log')
              .update({ kept: false, evaluated_at: new Date().toISOString() })
              .eq('user_id', user_id)
              .lt('date', twoDaysAgo)
              .is('kept', null);
          } catch (_e) { /* fail silently */ }
        } catch (_e) {}
      })();
    }

    result.consecutive_excuses = consecutiveExcuses;

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