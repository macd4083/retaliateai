/**
 * api/reflection-coach.js
 *
 * PRIMARY reflection coaching endpoint — supersedes api/reflection-chat.js.
 *
 * Pipeline per request:
 *   1. Receive body (user_id, session_id, session_state, history, user_message, context)
 *   2. Run classify-intent internally (or accept pre-classified intent_data from client)
 *   3. Load context in parallel: follow_up_queue, growth_markers, reflection_patterns,
 *      last-7-session summaries, yesterday commitment, user profile, active goals
 *   4. Decide if a queued follow-up should surface before the main response
 *   5. Build the GPT-4o prompt with all context + anti-excuse instructions + exercise workflow
 *   6. Call GPT-4o and parse the structured response
 *   7. Post-response DB writes (checklist update, follow-up queue, growth markers,
 *      blocker patterns, session state) — all fail silently
 *   8. Return full response shape to client
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Shared constants ──────────────────────────────────────────────────────────

const DEFAULT_CHECKLIST = { wins: false, honest: false, plan: false, identity: false };

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Retaliate AI nightly reflection coach.

PERSONALITY:
- Smart, honest friend who has read every self-development book but doesn't sound like it
- Warm but direct. You notice things and say them. Not preachy, not generic
- Casual language. Short sentences. Real talk
- 2-3 sentences max per message. One question only. Never dump
- Celebrate wins with genuine energy, not corporate cheerleading
- Do NOT let people off the hook — ask the follow-up question

CORE RULES:
- NEVER validate excuses. Acknowledge frustration, pivot immediately to what's in their control
- NEVER be a therapist. Be a coach. Forward-focused, action-oriented
- NEVER ask two questions at once
- NEVER be generic — use their actual words, goals, and why
- NEVER catastrophize or pile on when someone is struggling
- ALWAYS connect observations back to their identity and future self
- IF a follow-up from the queue is due, surface it BEFORE moving forward with anything else
- IF a growth marker check-in is due, weave it in naturally

ON VENTING:
- Let them get it out — one message of full acknowledgment
- Then: "Okay — and what part of that is yours to work with?"
- This is NOT harsh. It is empowering. You believe in their agency.

ON THE CHECKLIST (wins / honest / plan / identity):
- These are background goals, not rigid stages
- Any message can fill any item — track silently
- After ~8 messages, if items are still empty, weave them in naturally
- Never say "you haven't completed X" — always a natural human transition

ON EXERCISES:
- Briefly explain WHY before running an exercise (only if first time — check exercises_explained)
- Keep explanation to 1 sentence. Then run it.
- After exercise: connect result back to their identity, goals, or future self

ANTI-EXCUSE SYSTEM (activated when accountability_signal === "excuse"):
Step 1 (consecutive_excuses === 1):
  Acknowledge without validating: "Yeah, [X] is genuinely frustrating."
  Immediate pivot: "Here's what I keep coming back to though — what was the part that was yours to control?"
Step 2 (consecutive_excuses >= 2):
  "I'm not trying to dismiss [X]. But I notice we keep landing on what you couldn't do. What could you have done differently, even with [X] being true?"
Step 3 (consecutive_excuses >= 3):
  Pull future_self from context.
  "I want to be straight with you — I'm hearing a lot of reasons why it didn't work. But the version of you that [future_self] doesn't live there. What would they say right now?"
Never punitive. Never preachy. Always warm but direct.

EXERCISE WORKFLOWS:

gratitude_anchor:
  - Brief why (first time only): "Gratitude isn't about toxic positivity — it literally retrains your brain's threat-scanner."
  - Ask: "Name one thing from today that's still working, even if it's small."
  - After answer: Reflect it back and connect to their identity or goals.
  - Chips: ["Still has momentum 💪", "Small but real ✅", "Hard to find one 😔"]

why_reconnect:
  - Pull 3-layer why from context (why_layer_1 → why_layer_2 → why_layer_3).
  - "You told me this matters because [why]. Does that still feel true?"
  - If yes: "So what's getting between you and that right now?"
  - If no: "What changed? What does it feel like it's about now?"

evidence_audit:
  - Brief why (first time only): "When we doubt ourselves, we selectively forget evidence. Let's build a case."
  - Seed with recent wins if available from context.
  - "Name three things you've actually done in the last 30 days that the version of you who's failing wouldn't have done."

implementation_intention:
  - Brief why (first time only): "Vague plans fail. Implementation intentions work because your brain treats specifics as commitments."
  - "Not what you want to do. When exactly — day, time. Where. What's the first 2-minute action."
  - Push back if too vague: "What day? What time? Be specific."
  - Store result as tomorrow_commitment in extracted_data.

values_clarification:
  - "Forget goals for a second. If no one was watching and there were no consequences — what would you actually spend your time on?"
  - Follow up: "What does that tell you about what actually matters to you?"
  - Connect back to their life_areas from context.

future_self_bridge:
  - Pull future_self from context.
  - "You told me that in a year you want to be [future_self]. What would that version of you say about tonight?"
  - Follow up: "What's one decision you can make right now that moves toward that?"

ownership_reframe:
  - "Okay — and what was the part that was in your control?"
  - If ownership follows: Reinforce it. "That's the only part that matters. So what do you do with that?"
  - If another excuse follows: Move to anti-excuse step 3.

triage_one_thing:
  - "We're not solving everything tonight. Out of everything you're carrying — what's the ONE thing that actually matters most?"
  - After they identify it: "Good. Everything else is noise for tonight. What's one move on that one thing?"

identity_reinforcement:
  - "That's not luck or a one-off. That's a pattern emerging. What does doing [that] say about who you're becoming?"
  - Pull identity_statement from context.
  - "You told me you're someone who [identity_statement]. Tonight proves it."

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
    "self_hype_message": null
  },
  "exercise_run": "none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement",
  "checklist_updates": {"wins": false, "honest": false, "plan": false, "identity": false},
  "follow_up_queued": false,
  "is_session_complete": false
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getTimeGreeting() {
  const period = getTimeOfDay();
  const map = {
    morning: "Good morning — let's reflect on yesterday.",
    afternoon: 'Hey, taking a moment this afternoon to reflect.',
    evening: "Good evening — let's talk about today.",
    night: "Hey, it's getting late. Let's do a quick reflection before you sleep.",
  };
  return map[period];
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// ── Parallel context loaders (all fail silently) ──────────────────────────────

async function loadFollowUpQueue(userId, currentSignals = []) {
  try {
    let query = supabase
      .from('follow_up_queue')
      .select('id, context, question, trigger_condition, check_back_after')
      .eq('user_id', userId)
      .eq('triggered', false)
      .is('resolved_at', null);

    const { data } = await query;
    if (!data || data.length === 0) return [];

    const todayStr = today();
    return data.filter((item) => {
      if (item.check_back_after <= todayStr) return true;
      if (item.trigger_condition && currentSignals.includes(item.trigger_condition)) return true;
      return false;
    });
  } catch (_e) {
    return [];
  }
}

async function loadGrowthMarkers(userId) {
  try {
    const { data } = await supabase
      .from('growth_markers')
      .select('id, theme, check_in_message, check_in_after')
      .eq('user_id', userId)
      .eq('checked_in', false)
      .lte('check_in_after', today())
      .not('check_in_after', 'is', null);
    return data || [];
  } catch (_e) {
    return [];
  }
}

async function loadReflectionPatterns(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data } = await supabase
      .from('reflection_patterns')
      .select('label, occurrence_count, pattern_type')
      .eq('user_id', userId)
      .gte('last_seen_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('occurrence_count', { ascending: false })
      .limit(5);
    return data || [];
  } catch (_e) {
    return [];
  }
}

async function loadRecentSessionsSummary(userId) {
  try {
    const { data } = await supabase
      .from('reflection_sessions')
      .select('date, wins, misses, tomorrow_commitment, current_stage, checklist, mood_end_of_day')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(7);
    return data || [];
  } catch (_e) {
    return [];
  }
}

async function loadYesterdayCommitment(userId) {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { data } = await supabase
      .from('reflection_sessions')
      .select('tomorrow_commitment')
      .eq('user_id', userId)
      .eq('date', yesterday.toISOString().split('T')[0])
      .maybeSingle();
    return data?.tomorrow_commitment || null;
  } catch (_e) {
    return null;
  }
}

async function loadUserProfile(userId) {
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select(
        'full_name, display_name, bio, identity_statement, big_goal, why, future_self, life_areas, blockers, exercises_explained'
      )
      .eq('id', userId)
      .maybeSingle();
    return data || null;
  } catch (_e) {
    return null;
  }
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
  } catch (_e) {
    return [];
  }
}

// ── Classify intent (internal call, falls back to safe defaults) ──────────────

async function classifyIntent(userMessage, sessionContext = {}) {
  const CLASSIFIER_SYSTEM = `You are a message intent classifier for a nightly reflection coaching app.
Return ONLY valid JSON:
{
  "intent": "<checkin|vent|question|advice_request|memory_query|stuck|celebrate|off_topic>",
  "energy_level": "<low|medium|high>",
  "accountability_signal": "<excuse|ownership|neutral>",
  "emotional_state": "<frustrated|proud|anxious|flat|motivated|overwhelmed|reflective>",
  "checklist_content": {"wins": false, "honest": false, "plan": false, "identity": false},
  "suggested_exercise": "<none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement>"
}
EXERCISE ROUTING: excuse→ownership_reframe | low+frustrated→gratitude_anchor | stuck→values_clarification | motivation vent→why_reconnect | self-doubt→evidence_audit | procrastination→implementation_intention | celebrate/proud→identity_reinforcement | overwhelmed→triage_one_thing | reflective→future_self_bridge | memory_query→none | no signals→none
ACCOUNTABILITY: excuse=blaming external, "can't because X" | ownership="I did/didn't", personal responsibility | neutral=factual
No markdown. No explanation.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        {
          role: 'user',
          content: `[Stage: ${sessionContext.current_stage || 'wins'}]\nUser message: "${userMessage}"`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 150,
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (_e) {
    return {
      intent: 'checkin',
      energy_level: 'medium',
      accountability_signal: 'neutral',
      emotional_state: 'flat',
      checklist_content: { ...DEFAULT_CHECKLIST },
      suggested_exercise: 'none',
    };
  }
}

// ── Post-response DB writes (all fail silently) ───────────────────────────────

async function updateSessionChecklist(sessionId, checklistUpdates) {
  try {
    // Fetch current checklist first, then merge
    const { data: current } = await supabase
      .from('reflection_sessions')
      .select('checklist')
      .eq('id', sessionId)
      .maybeSingle();
    const merged = { ...(current?.checklist || { ...DEFAULT_CHECKLIST }), ...checklistUpdates };
    await supabase
      .from('reflection_sessions')
      .update({ checklist: merged, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  } catch (_e) {}
}

async function updateSessionExercise(sessionId, exerciseName, consecutiveExcuses) {
  try {
    const { data: current } = await supabase
      .from('reflection_sessions')
      .select('exercises_run, intent_signals')
      .eq('id', sessionId)
      .maybeSingle();
    const exercisesRun = Array.isArray(current?.exercises_run) ? current.exercises_run : [];
    if (exerciseName && exerciseName !== 'none' && !exercisesRun.includes(exerciseName)) {
      exercisesRun.push(exerciseName);
    }
    await supabase
      .from('reflection_sessions')
      .update({
        exercises_run: exercisesRun,
        consecutive_excuses: consecutiveExcuses,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  } catch (_e) {}
}

async function markExerciseExplained(userId, exerciseName, currentExplained = []) {
  try {
    if (currentExplained.includes(exerciseName)) return;
    const updated = [...currentExplained, exerciseName];
    await supabase
      .from('user_profiles')
      .update({ exercises_explained: updated })
      .eq('id', userId);
  } catch (_e) {}
}

async function queueFollowUp(userId, sessionId, { context, question, check_back_after, trigger_condition }) {
  try {
    await supabase.from('follow_up_queue').insert({
      user_id: userId,
      session_id: sessionId,
      context,
      question,
      check_back_after: check_back_after || daysFromNow(3),
      trigger_condition: trigger_condition || null,
    });
  } catch (_e) {}
}

async function markFollowUpTriggered(followUpId) {
  try {
    await supabase
      .from('follow_up_queue')
      .update({ triggered: true })
      .eq('id', followUpId);
  } catch (_e) {}
}

async function upsertGrowthMarker(userId, theme, { exercise_run, check_in_message }) {
  try {
    const { data: existing } = await supabase
      .from('growth_markers')
      .select('id, occurrence_count, exercises_run, check_in_after')
      .eq('user_id', userId)
      .eq('theme', theme)
      .maybeSingle();

    if (existing) {
      const exercises = Array.isArray(existing.exercises_run) ? existing.exercises_run : [];
      if (exercise_run && !exercises.includes(exercise_run)) exercises.push(exercise_run);
      const newCount = (existing.occurrence_count || 1) + 1;
      const shouldScheduleCheckIn = newCount >= 3 && !existing.check_in_after;
      await supabase
        .from('growth_markers')
        .update({
          occurrence_count: newCount,
          exercises_run: exercises,
          check_in_after: shouldScheduleCheckIn ? daysFromNow(14) : existing.check_in_after,
          check_in_message: check_in_message || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('growth_markers').insert({
        user_id: userId,
        theme,
        exercises_run: exercise_run ? [exercise_run] : [],
        occurrence_count: 1,
        check_in_message: check_in_message || null,
      });
    }
  } catch (_e) {}
}

async function upsertBlockerPatterns(userId, blockerTags) {
  if (!blockerTags || blockerTags.length === 0) return;
  const todayStr = today();
  for (const tag of blockerTags) {
    try {
      const { data: existing } = await supabase
        .from('reflection_patterns')
        .select('id, occurrence_count')
        .eq('user_id', userId)
        .eq('pattern_type', 'blocker')
        .eq('label', tag)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('reflection_patterns')
          .update({
            occurrence_count: existing.occurrence_count + 1,
            last_seen_date: todayStr,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('reflection_patterns').insert({
          user_id: userId,
          pattern_type: 'blocker',
          label: tag,
          occurrence_count: 1,
          last_seen_date: todayStr,
          first_seen_date: todayStr,
        });
      }
    } catch (_e) {}
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      user_id,
      session_id,
      session_state = {},
      history = [],
      user_message,
      context = {},
      intent_data: clientIntentData = null, // client may pre-classify and pass it in
    } = req.body;

    if (!user_id || !user_message) {
      return res.status(400).json({ error: 'user_id and user_message are required' });
    }

    const isInit = user_message === '__INIT__';

    // ── 1. Classify intent (skip for __INIT__) ────────────────────────────
    let intentData = clientIntentData;
    if (!intentData && !isInit) {
      intentData = await classifyIntent(user_message, session_state);
    }
    if (!intentData) {
      intentData = {
        intent: 'checkin',
        energy_level: 'medium',
        accountability_signal: 'neutral',
        emotional_state: 'flat',
        checklist_content: { ...DEFAULT_CHECKLIST },
        suggested_exercise: 'none',
      };
    }

    const currentSignals = [intentData?.intent, intentData?.emotional_state, intentData?.accountability_signal].filter(Boolean);

    // ── 2. Load context in parallel ───────────────────────────────────────
    const [
      followUpQueue,
      growthMarkers,
      reflectionPatterns,
      recentSessions,
      yesterdayCommitment,
      userProfile,
      activeGoals,
    ] = await Promise.all([
      loadFollowUpQueue(user_id, currentSignals),
      loadGrowthMarkers(user_id),
      loadReflectionPatterns(user_id),
      loadRecentSessionsSummary(user_id),
      loadYesterdayCommitment(user_id),
      loadUserProfile(user_id),
      loadActiveGoals(user_id),
    ]);

    // ── 3. Merge profile from context override (if client passed it) ──────
    const profile = {
      display_name: context.display_name || userProfile?.display_name || userProfile?.full_name || null,
      identity_statement: context.identity_statement || userProfile?.identity_statement || null,
      big_goal: context.big_goal || userProfile?.big_goal || null,
      why: context.why || userProfile?.why || null,
      future_self: context.future_self || userProfile?.future_self || null,
      life_areas: context.life_areas || userProfile?.life_areas || [],
      blockers: context.blockers || userProfile?.blockers || [],
      exercises_explained: userProfile?.exercises_explained || [],
    };

    // ── 4. Determine consecutive_excuses from session_state ───────────────
    let consecutiveExcuses = session_state.consecutive_excuses || 0;
    if (intentData?.accountability_signal === 'excuse') {
      consecutiveExcuses += 1;
    } else if (intentData?.accountability_signal === 'ownership') {
      consecutiveExcuses = 0; // Reset on ownership
    }

    // ── 5. Check if a follow-up should surface first ──────────────────────
    const dueFollowUp = followUpQueue.length > 0 ? followUpQueue[0] : null;
    const dueGrowthMarker = growthMarkers.length > 0 ? growthMarkers[0] : null;

    // ── 6. Build rich context for the prompt ─────────────────────────────
    const patternsText = reflectionPatterns.length > 0
      ? reflectionPatterns.map((p) => `"${p.label}" (${p.occurrence_count}x, type: ${p.pattern_type})`).join('; ')
      : 'No recurring patterns yet.';

    const recentSessionsText = recentSessions.length > 0
      ? recentSessions.map((s) => {
          const wins = Array.isArray(s.wins) ? s.wins.map((w) => (typeof w === 'string' ? w : w.text)).filter(Boolean) : [];
          const misses = Array.isArray(s.misses) ? s.misses.map((m) => (typeof m === 'string' ? m : m.text)).filter(Boolean) : [];
          return `${s.date}: wins=[${wins.join(', ')}] misses=[${misses.join(', ')}] commitment="${s.tomorrow_commitment || ''}" stage=${s.current_stage || ''}`;
        }).join('\n  ')
      : 'No previous sessions.';

    const goalsText = activeGoals.length > 0
      ? activeGoals.map((g) => `"${g.title}"${g.why_it_matters ? ` (why: ${g.why_it_matters})` : ''}`).join('; ')
      : 'No active goals set yet.';

    const exercisesExplained = Array.isArray(profile.exercises_explained) ? profile.exercises_explained : [];
    const suggestedExercise = intentData?.suggested_exercise || 'none';
    const isFirstTimeExercise = suggestedExercise !== 'none' && !exercisesExplained.includes(suggestedExercise);

    // Build the rich context block injected as a user turn
    const contextBlock = {
      role: 'user',
      content: JSON.stringify({
        user_profile: {
          name: profile.display_name,
          identity_statement: profile.identity_statement,
          big_goal: profile.big_goal,
          why: profile.why,
          future_self: profile.future_self,
          life_areas: Array.isArray(profile.life_areas) ? profile.life_areas.join(', ') : '',
          blockers: Array.isArray(profile.blockers) ? profile.blockers.join(', ') : '',
        },
        active_goals: goalsText,
        yesterday_commitment: yesterdayCommitment || 'None recorded',
        recent_patterns: patternsText,
        recent_sessions: recentSessionsText,
        session_state: {
          ...session_state,
          consecutive_excuses: consecutiveExcuses,
        },
        intent_classification: intentData,
        follow_up_due: dueFollowUp
          ? { context: dueFollowUp.context, question: dueFollowUp.question }
          : null,
        growth_marker_due: dueGrowthMarker
          ? { theme: dueGrowthMarker.theme, check_in_message: dueGrowthMarker.check_in_message }
          : null,
        suggested_exercise: suggestedExercise,
        is_first_time_exercise: isFirstTimeExercise,
        exercises_explained: exercisesExplained,
        streak: context.reflection_streak || context.streak || 0,
        time_of_day: context.time_of_day || getTimeOfDay(),
        instructions: [
          dueFollowUp ? 'PRIORITY: Surface the follow_up_due question BEFORE your main response.' : null,
          dueGrowthMarker ? 'Weave in the growth_marker_due check-in naturally.' : null,
          intentData?.accountability_signal === 'excuse'
            ? `ANTI-EXCUSE: consecutive_excuses=${consecutiveExcuses}. Follow the anti-excuse protocol for this count.`
            : null,
          suggestedExercise !== 'none'
            ? `RUN EXERCISE: ${suggestedExercise}. is_first_time=${isFirstTimeExercise} (explain in 1 sentence if first time). Set exercise_run="${suggestedExercise}" in response.`
            : null,
          'Use their actual words, goals, and why — never be generic.',
          'One question only. 2-3 sentences max.',
        ].filter(Boolean),
      }),
    };

    // ── 7. Build messages array ───────────────────────────────────────────
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, contextBlock, ...history.slice(-20)];

    if (!isInit) {
      messages.push({ role: 'user', content: user_message });
    } else {
      const stage = session_state?.current_stage || 'wins';
      messages.push({
        role: 'user',
        content: `Open the ${stage} stage of tonight's reflection. Time greeting: "${getTimeGreeting()}". ${
          yesterdayCommitment
            ? `Yesterday's commitment: "${yesterdayCommitment}". If wins stage, reference it and ask if they followed through.`
            : 'No yesterday commitment recorded.'
        } ${
          (context.reflection_streak || context.streak || 0) > 1
            ? `They have a ${context.reflection_streak || context.streak}-night streak — acknowledge briefly.`
            : ''
        } Start with the mood chip selector. Return chips: [
          {"label":"Proud 🔥","value":"proud"},
          {"label":"Grateful 🙏","value":"grateful"},
          {"label":"Motivated 💪","value":"motivated"},
          {"label":"Okay 😐","value":"okay"},
          {"label":"Tired 😴","value":"tired"},
          {"label":"Stressed 😤","value":"stressed"}
        ]`,
      });
    }

    // ── 8. Call GPT-4o ────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: 600,
    });

    let result;
    try {
      result = JSON.parse(completion.choices[0].message.content);
    } catch (_parseErr) {
      result = {
        assistant_message: completion.choices[0].message.content,
        chips: null,
        stage_advance: false,
        new_stage: null,
        extracted_data: {},
        exercise_run: 'none',
        checklist_updates: { ...DEFAULT_CHECKLIST },
        follow_up_queued: false,
        is_session_complete: false,
      };
    }

    // Ensure required keys exist
    result.exercise_run = result.exercise_run || 'none';
    result.checklist_updates = result.checklist_updates || { ...DEFAULT_CHECKLIST };
    result.follow_up_queued = result.follow_up_queued || false;

    // Merge checklist_content from classifier into checklist_updates
    if (intentData?.checklist_content) {
      Object.keys(intentData.checklist_content).forEach((key) => {
        if (intentData.checklist_content[key]) result.checklist_updates[key] = true;
      });
    }

    // ── 9. Post-response DB writes (all non-blocking, fail silently) ──────
    const dbPromises = [];

    // Update session checklist
    if (session_id && Object.values(result.checklist_updates).some(Boolean)) {
      dbPromises.push(updateSessionChecklist(session_id, result.checklist_updates));
    }

    // Update session with exercise info and consecutive_excuses
    if (session_id) {
      dbPromises.push(updateSessionExercise(session_id, result.exercise_run, consecutiveExcuses));
    }

    // Mark exercise as explained if this was its first run
    if (result.exercise_run && result.exercise_run !== 'none' && isFirstTimeExercise) {
      dbPromises.push(markExerciseExplained(user_id, result.exercise_run, exercisesExplained));
    }

    // Mark follow-up as triggered
    if (dueFollowUp) {
      dbPromises.push(markFollowUpTriggered(dueFollowUp.id));
    }

    // Queue a follow-up if an exercise was run
    const exerciseRan = result.exercise_run && result.exercise_run !== 'none';
    if (exerciseRan && session_id) {
      dbPromises.push(
        queueFollowUp(user_id, session_id, {
          context: `${result.exercise_run} exercise was run during reflection`,
          question: `Last time we worked on ${result.exercise_run.replace(/_/g, ' ')} — how has that been showing up for you?`,
          check_back_after: daysFromNow(3),
          trigger_condition: intentData?.emotional_state,
        })
      );
      // Upsert growth marker
      dbPromises.push(
        upsertGrowthMarker(user_id, result.exercise_run, {
          exercise_run: result.exercise_run,
          check_in_message: `How has your work on ${result.exercise_run.replace(/_/g, ' ')} been going?`,
        })
      );
    }

    // Update session DB if stage advanced or data extracted
    if (session_id && (result.stage_advance || result.extracted_data || result.is_session_complete)) {
      const updates = {};
      if (result.stage_advance && result.new_stage) updates.current_stage = result.new_stage;
      if (result.extracted_data?.mood) updates.mood_end_of_day = result.extracted_data.mood;
      if (result.extracted_data?.tomorrow_commitment)
        updates.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
      if (result.extracted_data?.self_hype_message)
        updates.self_hype_message = result.extracted_data.self_hype_message;
      if (result.is_session_complete) {
        updates.is_complete = true;
        updates.completed_at = new Date().toISOString();
      }
      if (Object.keys(updates).length > 0) {
        dbPromises.push(
          supabase
            .from('reflection_sessions')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', session_id)
            .then(() => {})
            .catch(() => {})
        );
      }
    }

    // Upsert blocker patterns
    if (result.extracted_data?.blocker_tags?.length) {
      dbPromises.push(upsertBlockerPatterns(user_id, result.extracted_data.blocker_tags));
    }

    // Fire all DB writes in parallel — do not await (non-blocking)
    Promise.all(dbPromises).catch(() => {});

    // Attach consecutive_excuses to response so client can track it in session_state
    result.consecutive_excuses = consecutiveExcuses;

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in reflection-coach:', error);
    return res.status(500).json({
      error: 'Failed to process reflection',
      assistant_message: "Something went wrong on my end. Try sending that again — I'm here.",
      chips: null,
      stage_advance: false,
      new_stage: null,
      extracted_data: {},
      exercise_run: 'none',
      checklist_updates: { ...DEFAULT_CHECKLIST },
      follow_up_queued: false,
      is_session_complete: false,
      consecutive_excuses: 0,
    });
  }
}
