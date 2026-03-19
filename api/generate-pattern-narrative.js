/**
 * api/generate-pattern-narrative.js
 *
 * Generates real, user-data-driven narrative text for the "What We've Noticed"
 * section of Insights. Uses actual session summaries, wins, misses, and patterns
 * to produce prose — no templates.
 *
 * POST { user_id }
 *
 * Returns:
 *   narratives: [{ type: "blocker"|"strength"|"pattern", label, narrative, occurrences }]
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.body || {};
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    // ── 1. Load patterns (blockers + strengths, occurrence >= 2) ──────────
    const { data: patterns } = await supabase
      .from('reflection_patterns')
      .select('label, occurrence_count, pattern_type, description, first_seen_date, last_seen_date')
      .eq('user_id', user_id)
      .gte('occurrence_count', 2)
      .order('occurrence_count', { ascending: false })
      .limit(6);

    if (!patterns || patterns.length === 0) {
      return res.status(200).json({ narratives: [] });
    }

    // ── 2. Load last 30 sessions of summaries, wins, misses ──────────────
    const { data: sessions } = await supabase
      .from('reflection_sessions')
      .select('date, summary, wins, misses, tomorrow_commitment, mood_end_of_day, blocker_tags')
      .eq('user_id', user_id)
      .not('is_complete', 'is', null)
      .eq('is_complete', true)
      .order('date', { ascending: false })
      .limit(30);

    // ── 3. Load user profile for context ─────────────────────────────────
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('identity_statement, big_goal, why, short_term_state, long_term_patterns, strengths, growth_areas')
      .eq('id', user_id)
      .maybeSingle();

    if (!sessions || sessions.length === 0) {
      return res.status(200).json({ narratives: [] });
    }

    // ── 4. Build session context string ──────────────────────────────────
    const sessionContext = sessions
      .slice(0, 20)
      .map((s) => {
        const wins = Array.isArray(s.wins)
          ? s.wins.map((w) => (typeof w === 'string' ? w : w?.text)).filter(Boolean).join('; ')
          : '';
        const misses = Array.isArray(s.misses)
          ? s.misses.map((m) => (typeof m === 'string' ? m : m?.text)).filter(Boolean).join('; ')
          : '';
        const blockers = Array.isArray(s.blocker_tags) ? s.blocker_tags.join(', ') : '';
        let line = `[${s.date}]`;
        if (s.summary) line += ` ${s.summary}`;
        if (wins) line += ` Wins: ${wins}.`;
        if (misses) line += ` Struggles: ${misses}.`;
        if (blockers) line += ` Blockers: ${blockers}.`;
        if (s.tomorrow_commitment) line += ` Committed to: ${s.tomorrow_commitment}.`;
        return line;
      })
      .join('\n');

    const profileContext = [
      profile?.identity_statement ? `Identity: "${profile.identity_statement}"` : null,
      profile?.big_goal ? `Goal: "${profile.big_goal}"` : null,
      profile?.why ? `Why: "${profile.why}"` : null,
      profile?.short_term_state ? `Current state: ${profile.short_term_state}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const patternList = patterns.map((p) => ({
      label: p.label,
      type: p.pattern_type,
      occurrences: p.occurrence_count,
      first_seen: p.first_seen_date,
      last_seen: p.last_seen_date,
      description: p.description || null,
    }));

    // ── 5. Call GPT to generate real narratives ───────────────────────────
    const SYSTEM = `You are analyzing a person's real reflection session data to generate honest, specific insights.

You will receive:
- Their patterns (blockers and strengths they've shown up with)
- Their actual session history (summaries, wins, struggles, commitments)
- Their profile (identity, goal, why)

Generate ONE narrative paragraph per pattern. Requirements:
- Reference SPECIFIC things from their actual session data — actual wins they mentioned, actual struggles, actual dates, actual commitments
- Sound like a thoughtful human coach who has been paying close attention, not a template
- NEVER use generic phrases like "it's a signal", "worth sitting with", "it's not random", "that's not luck"
- DO NOT use the same sentence structure for each card
- Blockers: be honest about what you see — name the pattern plainly, reference when it showed up, note if they pushed through it anyway
- Strengths: be specific about what they actually did, show trajectory if you can see one (e.g. "a month ago... now...")
- Keep each narrative to 2-4 sentences max
- Write in second person ("you", "your")
- Use their actual words from their session data when possible

Return ONLY valid JSON:
{
  "narratives": [
    {
      "label": "<pattern label>",
      "type": "<blocker|strength|theme>",
      "occurrences": <number>,
      "narrative": "<your 2-4 sentence narrative>"
    }
  ]
}

If there is genuinely not enough data to say anything specific about a pattern, omit it from the array rather than being generic.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            patterns: patternList,
            session_history: sessionContext,
            profile: profileContext || 'No profile data yet.',
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 1200,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return res.status(200).json({ narratives: result.narratives || [] });
  } catch (err) {
    console.error('generate-pattern-narrative error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}