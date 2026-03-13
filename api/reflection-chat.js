import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are the Retaliate AI nightly reflection coach. You are talking to a college student or young adult who is ambitious, building something, and trying to grow.

YOUR PERSONALITY:
- You are like a smart, honest friend who has read every self-development book but doesn't sound like it
- Warm but direct. You notice things and say them. Not preachy, not generic
- You use casual language. Short sentences. Real talk
- 2-3 sentences max per message. Never dump. One question only
- You celebrate wins with genuine energy, not corporate cheerleading
- You don't let people off the hook — you ask the follow-up question

YOUR 4-STAGE JOB TONIGHT:

STAGE 1 — WINS (current_stage: "wins")
Goal: Help them feel the win, understand why it happened, and know how to repeat it
- Start by asking what went well or how they're feeling
- When they share a win: celebrate it genuinely first, THEN ask how it made them feel
- Dig into WHY it went well — what did they do that caused this?
- Ask: would they do that same thing again? How?
- Connect to their identity: "That sounds like someone who..."
- Look for gratitude angle — who helped them? What are they thankful for?
- Move to stage 2 after 2-3 meaningful exchanges about wins
- Chips to offer: mood chips at start, then reaction chips after wins

STAGE 2 — HONEST (current_stage: "honest")
Goal: Build pattern awareness, connect struggles to goals, develop honest self-reflection
- Transition: "Alright, let's get honest for a second..."
- Ask what didn't go as planned, or what they're carrying
- When they share a struggle: DON'T comfort immediately. Ask WHY first
- Dig into root cause: was it a decision, a habit, external, avoidance?
- Pattern awareness: if they've mentioned this before (check recent_patterns), say so. "You've mentioned this a few times recently..."
- Connect to goals: "How does this connect to where you're trying to go?"
- Identity challenge: "Is this the person you want to be?" (gently, not harshly)
- Acknowledge impact without catastrophizing
- Chips: "Totally my fault", "Outside my control", "Avoidance", "Still figuring it out"

STAGE 3 — TOMORROW (current_stage: "tomorrow")
Goal: Build one small, realistic commitment connected to their why
- Transition: "Okay, so tomorrow..."
- Ask: what's the ONE thing they can do differently or commit to?
- Keep it small and specific — not "be better", but "I will do X at Y time"
- Connect it to their goals/why it matters: "Why does that matter to you?"
- Make sure it's realistic — if it sounds too big, push back gently
- Reference yesterday's commitment if they have one: did they follow through?
- Chips: "Yes, I'll do it", "Need to think", "Set a reminder"

STAGE 4 — CLOSE (current_stage: "close")
Goal: End with self-compassion, genuine hype, and a reminder of their identity
- Transition: "Before we close tonight..."
- Ask them to write themselves one sentence of honest self-hype
- Help them if they don't know how — offer a stem: "I am someone who..."
- Reflect back what you noticed about them tonight
- End strong: remind them who they're becoming
- Reference their streak if > 1: "X nights in a row — that's not an accident"
- Chips: "I'm proud of myself", "Tomorrow is a new one", "I got this"

CONTEXT YOU WILL RECEIVE EACH MESSAGE:
- yesterday_commitment: what they said they'd do — CHECK if they mentioned following through
- recent_patterns: recurring blockers/themes from the past 7 days
- active_goals: their goals and why they matter to them
- user_profile: who they are, what they're building
- user_identity: structured identity data (name, big_goal, why, future_self, life_areas, blockers)
- reflection_streak: how many nights in a row
- time_of_day: morning/afternoon/evening/night
- session_state: where we are, what's been collected so far

IMPORTANT RULES:
- NEVER ask two questions in one message
- NEVER be generic — use their actual words back to them
- NEVER skip stages — always complete them in order
- ALWAYS use context from their goals/profile to make it personal
- If they give a short answer, probe deeper before moving on
- If they give a long answer, acknowledge it fully first

RETURN JSON EXACTLY:
{
  "assistant_message": "your message (2-3 sentences, one question)",
  "chips": [{"label": "Proud 🔥", "value": "proud"}] or null,
  "stage_advance": true/false,
  "new_stage": "wins|honest|tomorrow|close|complete" or null,
  "extracted_data": {
    "mood": null,
    "win_text": null,
    "miss_text": null,
    "blocker_tags": [],
    "tomorrow_commitment": null,
    "self_hype_message": null
  },
  "session_updates": {},
  "is_session_complete": false
}`;

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getTimeGreeting() {
  const period = getTimeOfDay();
  const greetings = {
    morning: "Good morning — let's reflect on yesterday.",
    afternoon: "Hey, taking a moment this afternoon to reflect.",
    evening: "Good evening — let's talk about today.",
    night: "Hey, it's getting late. Let's do a quick reflection before you sleep.",
  };
  return greetings[period];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      user_id,
      session_id,
      session_state,
      history = [],
      user_message,
      context = {},
    } = req.body;

    if (!user_id || !user_message) {
      return res.status(400).json({ error: 'user_id and user_message are required' });
    }

    // ── 1. Load yesterday's commitment ────────────────────────────────────
    let yesterdayCommitment = context.yesterday_commitment || null;
    if (!yesterdayCommitment && user_id) {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const { data } = await supabase
          .from('reflection_sessions')
          .select('tomorrow_commitment')
          .eq('user_id', user_id)
          .eq('date', yesterdayStr)
          .maybeSingle();
        if (data?.tomorrow_commitment) yesterdayCommitment = data.tomorrow_commitment;
      } catch (_e) {}
    }

    // ── 2. Load recent patterns (last 7 days) ─────────────────────────────
    let recentPatternsText = '';
    if (user_id) {
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data: patterns } = await supabase
          .from('reflection_patterns')
          .select('label, occurrence_count, pattern_type')
          .eq('user_id', user_id)
          .gte('last_seen_date', sevenDaysAgo.toISOString().split('T')[0])
          .order('occurrence_count', { ascending: false })
          .limit(5);
        if (patterns && patterns.length > 0) {
          recentPatternsText = patterns
            .map((p) => `"${p.label}" (seen ${p.occurrence_count}x this week, type: ${p.pattern_type})`)
            .join('; ');
        }
      } catch (_e) {}
    }

    // ── 3. Load user profile ──────────────────────────────────────────────
    let userProfileText = '';
    if (user_id) {
      try {
        const ctxName = context.display_name || null;
        const ctxIdentity = context.identity_statement || null;
        const ctxBigGoal = context.big_goal || null;
        const ctxWhy = context.why || null;
        const ctxFutureSelf = context.future_self || null;
        const ctxLifeAreas = Array.isArray(context.life_areas) ? context.life_areas : [];
        const ctxBlockers = Array.isArray(context.blockers) ? context.blockers : [];

        if (ctxName || ctxIdentity || ctxBigGoal) {
          const parts = [];
          if (ctxName) parts.push(`Name: ${ctxName}`);
          if (ctxIdentity) parts.push(`Identity: ${ctxIdentity}`);
          if (ctxBigGoal) parts.push(`Big goal: ${ctxBigGoal}`);
          if (ctxWhy) parts.push(`Their why: ${ctxWhy}`);
          if (ctxFutureSelf) parts.push(`Future self vision: ${ctxFutureSelf}`);
          if (ctxLifeAreas.length) parts.push(`Life focus areas: ${ctxLifeAreas.join(', ')}`);
          if (ctxBlockers.length) parts.push(`Known blockers: ${ctxBlockers.join(', ')}`);
          userProfileText = parts.join('. ');
        } else {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('full_name, display_name, bio, identity_statement, big_goal, why, future_self, life_areas, blockers')
            .eq('id', user_id)
            .maybeSingle();
          if (profile) {
            const parts = [];
            const name = profile.display_name || profile.full_name;
            if (name) parts.push(`Name: ${name}`);
            if (profile.bio) parts.push(`About: ${profile.bio}`);
            if (profile.identity_statement) parts.push(`Identity: ${profile.identity_statement}`);
            if (profile.big_goal) parts.push(`Big goal: ${profile.big_goal}`);
            if (profile.why) parts.push(`Their why: ${profile.why}`);
            if (profile.future_self) parts.push(`Future self vision: ${profile.future_self}`);
            if (profile.life_areas?.length) parts.push(`Life focus areas: ${profile.life_areas.join(', ')}`);
            if (profile.blockers?.length) parts.push(`Known blockers: ${profile.blockers.join(', ')}`);
            userProfileText = parts.join('. ');
          }
        }
      } catch (_e) {}
    }

    // ── 4. Load active goals ──────────────────────────────────────────────
    let activeGoalsText = '';
    if (user_id) {
      try {
        const { data: goals } = await supabase
          .from('goals')
          .select('title, why_it_matters, category, target_date')
          .eq('user_id', user_id)
          .eq('status', 'active')
          .limit(5);
        if (goals && goals.length > 0) {
          activeGoalsText = goals
            .map((g) => `"${g.title}"${g.why_it_matters ? ` (why: ${g.why_it_matters})` : ''}${g.category ? ` [${g.category}]` : ''}`)
            .join('; ');
        }
      } catch (_e) {}
    }

    // ── 5. Build rich context message ─────────────────────────────────────
    const contextMessage = {
      role: 'user',
      content: JSON.stringify({
        context: {
          yesterday_commitment: yesterdayCommitment || 'None recorded',
          recent_patterns: recentPatternsText || 'No patterns yet — this is early data.',
          user_profile: userProfileText || 'No profile set up yet.',
          active_goals: activeGoalsText || 'No active goals set yet.',
          reflection_streak: context.reflection_streak || context.streak || 0,
          time_of_day: context.time_of_day || getTimeOfDay(),
        },
        user_identity: {
          name: context.display_name || null,
          identity_statement: context.identity_statement || null,
          big_goal: context.big_goal || null,
          why: context.why || null,
          future_self: context.future_self || null,
          life_areas: Array.isArray(context.life_areas) ? context.life_areas.join(', ') : '',
          blockers: Array.isArray(context.blockers) ? context.blockers.join(', ') : '',
          yesterday_commitment: yesterdayCommitment || 'none',
          streak: context.reflection_streak || context.streak || 0,
        },
        session_state: session_state || {},
        instruction:
          'Use the context and user_identity above deeply. Reference their actual goals, why, and identity. Notice their patterns. Ask one question at a time. Be personal, not generic.',
      }),
    };

    // ── 6. Build messages array ───────────────────────────────────────────
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      contextMessage,
      ...history.slice(-20),
    ];

    if (user_message !== '__INIT__') {
      messages.push({ role: 'user', content: user_message });
    } else {
      const stage = session_state?.current_stage || 'wins';
      const timeGreeting = getTimeGreeting();
      messages.push({
        role: 'user',
        content: `Please open the ${stage} stage of tonight's reflection. Time greeting: "${timeGreeting}". ${
          yesterdayCommitment
            ? `Yesterday they committed to: "${yesterdayCommitment}". If this is the wins stage, reference this first and ask if they followed through.`
            : 'No commitment from yesterday.'
        } ${
          context.reflection_streak > 1
            ? `They have a ${context.reflection_streak}-night streak — acknowledge it briefly.`
            : ''
        } Start with the mood chip selector for the wins stage. Return JSON with chips for mood: [
          {"label":"Proud 🔥","value":"proud"},
          {"label":"Grateful 🙏","value":"grateful"},
          {"label":"Motivated 💪","value":"motivated"},
          {"label":"Okay 😐","value":"okay"},
          {"label":"Tired 😴","value":"tired"},
          {"label":"Stressed 😤","value":"stressed"}
        ]`,
      });
    }

    // ── 7. Call GPT-4o ────────────────────────────────────────────────────
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
    } catch (_parseError) {
      result = {
        assistant_message: completion.choices[0].message.content,
        chips: null,
        stage_advance: false,
        new_stage: null,
        extracted_data: {},
        session_updates: {},
        is_session_complete: false,
      };
    }

    // ── 8. Save AI message to DB ──────────────────────────────────────────
    // FIX: Removed server-side assistant message save.
    // The client (ReflectionV2.jsx) handles saving user messages itself.
    // The server previously double-saved assistant messages alongside the client.
    // Now the server just returns the result and the client saves the assistant message.

    // ── 9. Update session if stage advanced ──────────────────────────────
    if (session_id && (result.stage_advance || result.extracted_data)) {
      try {
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
          await supabase
            .from('reflection_sessions')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', session_id);
        }
      } catch (_e) {}
    }

    // ── 10. Upsert blocker patterns ───────────────────────────────────────
    if (result.extracted_data?.blocker_tags?.length && user_id) {
      const today = new Date().toISOString().split('T')[0];
      for (const tag of result.extracted_data.blocker_tags) {
        try {
          const { data: existing } = await supabase
            .from('reflection_patterns')
            .select('id, occurrence_count')
            .eq('user_id', user_id)
            .eq('pattern_type', 'blocker')
            .eq('label', tag)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('reflection_patterns')
              .update({
                occurrence_count: existing.occurrence_count + 1,
                last_seen_date: today,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
          } else {
            await supabase.from('reflection_patterns').insert({
              user_id,
              pattern_type: 'blocker',
              label: tag,
              occurrence_count: 1,
              last_seen_date: today,
              first_seen_date: today,
            });
          }
        } catch (_e) {}
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in reflection-chat:', error);
    return res.status(500).json({
      error: 'Failed to process reflection',
      assistant_message: "Something went wrong on my end. Try sending that again — I'm here.",
      chips: null,
      stage_advance: false,
      new_stage: null,
      extracted_data: {},
      session_updates: {},
      is_session_complete: false,
    });
  }
}