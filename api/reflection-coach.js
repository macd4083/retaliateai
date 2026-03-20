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

DEPTH CONVERSATION: When the user is in a reflective back-and-forth ("what do you think" style exchange), allow the chain to continue naturally. Multiple consecutive "what do you think" exchanges are GOOD — do not prematurely pivot to action or next stage. Only close a depth thread when the user has reached an insight or naturally signals they want to move on. When the user answers a reflective/opinion question with their own reflection, the coach IS ALLOWED to follow up with another reflective question — do not count this as "drilling a topic".

ON THE CHECKLIST (wins / honest / plan / identity):
- These are background goals — track silently from conversation
- wins: a real win or effort was mentioned. After the FIRST win is mentioned, always follow up with an open invitation to share more: e.g. "What else went well today?" or "What's another one?" — do NOT advance to the honest stage after just one win exchange. Let the user share as many wins as they want before moving on.
- honest: they acknowledged something they're struggling with or could improve
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
    "depth_insight": null
  },
  "exercise_run": "none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement|depth_probe",
  "checklist_updates": {"wins": false, "honest": false, "plan": false, "identity": false},
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
  if (stage === 'wins' && cl.wins && messageCount >= 4) return 'honest';
  if (stage === 'honest' && cl.honest) return 'tomorrow';
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
      .select('date, wins, misses, tomorrow_commitment, current_stage, checklist, mood_end_of_day, summary')
      .eq('user_id', userId)
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
      .select('title, why_it_matters, category')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(5);
    return data || [];
  } catch (_e) { return []; }
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
    ? sessionState.wins.map((w) => (typeof w === 'string' ? w : w.text)).filter(Boolean).join(', ')
    : result.extracted_data?.win_text || 'not recorded';
  const miss = result.extracted_data?.miss_text || sessionState.misses?.[0] || null;
  const commitment = sessionState.tomorrow_commitment || result.extracted_data?.tomorrow_commitment || null;
  const insight = result.extracted_data?.depth_insight || null;
  const exercises = Array.isArray(sessionState.exercises_run) ? sessionState.exercises_run.join(', ') : 'none';
  const mood = sessionState.mood_end_of_day || result.extracted_data?.mood || null;

  let summary = `Session ${dateStr}: ${name} worked on ${wins}.`;
  if (miss) summary += ` Honest moment: ${miss}.`;
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
  "future_self_update": "..." | null
}`;

    const recentSummaries = recentSessions
      .filter((s) => s.summary)
      .slice(0, 3)
      .map((s) => `${s.date}: ${s.summary}`)
      .join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      max_tokens: 600,
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

    const [followUpQueue, growthMarkers, reflectionPatterns, recentSessions, yesterdayCommitment, userProfile, activeGoals, commitmentStats] =
      await Promise.all([
        loadFollowUpQueue(user_id, currentSignals, client_local_date),
        loadGrowthMarkers(user_id, client_local_date),
        loadReflectionPatterns(user_id, client_local_date),
        loadRecentSessionsSummary(user_id),
        loadYesterdayCommitment(user_id, client_local_date),
        loadUserProfile(user_id),
        loadActiveGoals(user_id),
        loadCommitmentStats(user_id, client_local_date),
      ]);

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
    const honestMissing = !mergedChecklist.honest && messageCount >= 4;
    const identityMissing = !mergedChecklist.identity && messageCount >= 6;

    // ── 8. Build compact context block ───────────────────────────────────
    const exercisesExplained = Array.isArray(profile.exercises_explained) ? profile.exercises_explained : [];
    const isFirstTimeExercise = suggestedExercise !== 'none' && !exercisesExplained.includes(suggestedExercise);

    const patternsText = reflectionPatterns.length > 0
      ? reflectionPatterns.map((p) => `${p.label}(${p.occurrence_count}x)`).join('; ')
      : 'none';

    const recentSessionsText = recentSessions.slice(0, 3).map((s) => {
      if (s.summary) return `${s.date}: ${s.summary}`;
      const wins = Array.isArray(s.wins) ? s.wins.map((w) => (typeof w === 'string' ? w : w.text)).filter(Boolean) : [];
      return `${s.date}: wins=[${wins.slice(0, 2).join(', ')}] commitment="${s.tomorrow_commitment || ''}"`;
    }).join(' | ') || 'none';

    // ── 8b. Memory search for question/advice/memory_query/reflective intents ────────
    const isMemoryMode = ['question', 'advice_request', 'memory_query'].includes(intentData?.intent);
    const shouldSearchMemories = isMemoryMode || intentData?.emotional_state === 'reflective';
    let relevantMemories = [];
    if (!isInit && shouldSearchMemories) {
      relevantMemories = await searchRelevantMemories(user_id, user_message, 3);
    }

    const goalsText = activeGoals.length > 0
      ? activeGoals.map((g) => `"${g.title}"`).join('; ')
      : 'none';

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
        goals: goalsText,
        yesterday_commitment: yesterdayCommitment || 'none',
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
          honestMissing
            ? `HONEST MISSING: Gently probe for a miss or honest moment with self-awareness questions. E.g. "Where did you feel like you weren't fully showing up today?" or "Is there a moment from today that's still sitting with you?" or "What part of today are you least proud of — not what you'd fix, just what happened?" Goal is self-awareness about TODAY, not action planning. Do NOT ask "what would you do differently" — that belongs in tomorrow. Weave it naturally.`
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
            : 'No yesterday commitment. Open with a warm greeting and mood chips.'
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
        queueFollowUp(user_id, session_id, {
          context: `${result.exercise_run} exercise run during reflection`,
          question: `Last time we worked on ${result.exercise_run.replace(/_/g, ' ')} — how has that been showing up?`,
          check_back_after: daysFromNow(3, client_local_date),
          trigger_condition: intentData?.emotional_state,
        }, client_local_date)
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
      if (result.extracted_data?.tomorrow_commitment) updates.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
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

    if (result.extracted_data?.blocker_tags?.length) {
      dbPromises.push(upsertBlockerPatterns(user_id, result.extracted_data.blocker_tags, client_local_date));
    }

    Promise.all(dbPromises).catch(() => {});

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