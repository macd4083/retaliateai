import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are an AI nightly reflection coach for a college student using the Retaliate AI journaling app.

Your personality:
- Honest but compassionate. Never preachy or generic.
- Direct — say what you notice, don't sugarcoat patterns, but always with care.
- Warm, like a smart friend who believes in them deeply.
- You speak conversationally, not like a therapist or productivity app.
- Short replies: 2–4 sentences max per message. Never dump too much at once.
- Ask ONE question at a time. Never stack multiple questions.

Your job tonight:
Guide them through 4 stages in order:
1. WINS — what went well, feelings, gratitude, how to repeat it
2. HONEST — what didn't go well, why, impact, pattern awareness, identity connection
3. TOMORROW — design one realistic change, connect to their why and goals, commitment
4. CLOSE — self-compassion, self-hype, encouragement to future self

Rules:
- Always have access to yesterday's commitment/plan and reference it specifically
- In WINS stage: celebrate wins genuinely, ask how it felt, what made it possible, connect to identity
- In HONEST stage: be curious not judgmental. Ask what they were protecting themselves from. Reference patterns if they keep showing up.
- In TOMORROW stage: suggest small, specific experiments. Ask about time/place/action. Check realism.
- In CLOSE stage: write something genuinely warm. Reference something specific they said tonight.
- When you detect a blocker pattern repeat (3+ times), gently name it: "I notice [X] keeps showing up..."
- When moving stages, make it natural in conversation, don't announce it mechanically.
- The session is complete after CLOSE stage when the user has written their hype message.

Context you will receive:
- Yesterday's commitment
- Current session state (which stage, what's been collected)
- Recent history (last 7 days patterns)
- User's active goals
- User profile summary
- Time of day

Return JSON with exactly this structure:
{
  "assistant_message": "your response (2-4 sentences, conversational)",
  "chips": [{"label": "Proud 🔥", "value": "proud"}, ...] or null,
  "stage_advance": true/false,
  "new_stage": "wins|honest|tomorrow|close|complete" or null,
  "extracted_data": {
    "mood": "...",
    "win_text": "...",
    "miss_text": "...",
    "blocker_tags": [...],
    "tomorrow_commitment": "...",
    "self_hype_message": "..."
  },
  "session_updates": {},
  "is_session_complete": false
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, session_id, session_state, history = [], user_message, context = {} } = req.body;

    if (!user_id || !user_message) {
      return res.status(400).json({ error: 'user_id and user_message are required' });
    }

    // 1. Load yesterday's commitment
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
        yesterdayCommitment = data?.tomorrow_commitment || null;
      } catch (_e) {
        // Non-fatal
      }
    }

    // 2. Load recent patterns
    let recentPatternsText = context.recent_patterns || '';
    if (!recentPatternsText && user_id) {
      try {
        const since = new Date();
        since.setDate(since.getDate() - 14);
        const sinceStr = since.toISOString().split('T')[0];
        const { data: patterns } = await supabase
          .from('reflection_patterns')
          .select('pattern_type, label, occurrence_count')
          .eq('user_id', user_id)
          .gte('last_seen_date', sinceStr)
          .order('occurrence_count', { ascending: false })
          .limit(10);
        if (patterns && patterns.length > 0) {
          recentPatternsText = patterns
            .map((p) => `${p.label} (${p.occurrence_count}x recently)`)
            .join(', ');
        }
      } catch (_e) {
        // Non-fatal
      }
    }

    // 3. Load user profile
    let userProfileText = context.user_profile || '';
    if (!userProfileText && user_id) {
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('summary_text')
          .eq('user_id', user_id)
          .maybeSingle();
        userProfileText = profile?.summary_text || 'New user — no profile yet.';
      } catch (_e) {
        userProfileText = 'No profile yet.';
      }
    }

    // 4. Load active goals
    let activeGoalsText = '';
    if (user_id) {
      try {
        const { data: goals } = await supabase
          .from('goals')
          .select('title, why_it_matters')
          .eq('user_id', user_id)
          .eq('status', 'active')
          .limit(5);
        if (goals && goals.length > 0) {
          activeGoalsText = goals.map((g) => `"${g.title}" — ${g.why_it_matters || ''}`).join('; ');
        }
      } catch (_e) {
        // Non-fatal
      }
    }

    // 5. Build context message
    const contextMessage = {
      role: 'user',
      content: JSON.stringify({
        context: {
          yesterday_commitment: yesterdayCommitment,
          recent_patterns: recentPatternsText || 'No recent patterns yet.',
          user_profile: userProfileText,
          active_goals: activeGoalsText || 'No active goals yet.',
          reflection_streak: context.reflection_streak || 0,
          time_of_day: context.time_of_day || getTimeOfDay(),
        },
        session_state: session_state || {},
        instruction:
          'Use the context above to guide the conversation. Remember: short, warm, one question at a time.',
      }),
    };

    // 6. Build conversation history
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      contextMessage,
      ...history.slice(-20), // last 20 messages for context
    ];

    // Add current user message only if not __INIT__
    if (user_message !== '__INIT__') {
      messages.push({ role: 'user', content: user_message });
    } else {
      // Opening message — instruct AI to start the session
      const stage = session_state?.current_stage || 'wins';
      const timeGreeting = getTimeGreeting();
      messages.push({
        role: 'user',
        content: `Please open the ${stage} stage of tonight's reflection. Time greeting: "${timeGreeting}". ${
          yesterdayCommitment
            ? `Yesterday they committed to: "${yesterdayCommitment}". Reference this.`
            : 'No commitment from yesterday.'
        } Start with the mood chip selector. Return JSON with chips for mood: [{label:"Proud 🔥",value:"proud"},{label:"Grateful 🙏",value:"grateful"},{label:"Okay 😐",value:"okay"},{label:"Guilty 😔",value:"guilty"},{label:"Stressed 😤",value:"stressed"},{label:"Tired 😴",value:"tired"}]`,
      });
    }

    // 7. Call GPT-4o
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

    // 8. Upsert blocker patterns if any were extracted
    if (result.extracted_data?.blocker_tags?.length && user_id) {
      const blockerTags = result.extracted_data.blocker_tags;
      const today = new Date().toISOString().split('T')[0];

      for (const tag of blockerTags) {
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
        } catch (_e) {
          // Non-fatal
        }
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in reflection-chat:', error);
    return res.status(500).json({
      error: 'Failed to process reflection',
      assistant_message:
        "Something went wrong on my end. Try sending that again — I'm here.",
      chips: null,
      stage_advance: false,
      new_stage: null,
      extracted_data: {},
      session_updates: {},
      is_session_complete: false,
    });
  }
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  if (hour >= 23 || hour < 2) return 'late_night';
  if (hour >= 2 && hour < 6) return 'early_morning';
  return 'late';
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18 && hour < 23) return 'Good evening';
  if (hour >= 23 || hour < 2) return "Still up?";
  if (hour >= 2 && hour < 6) return "Can't sleep?";
  return 'Hey';
}
