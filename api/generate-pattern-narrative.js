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

    // ── 2b. Load depth insights from reflection_messages (last 30 days) ──
    const { data: depthInsights } = await supabase
      .from('reflection_messages')
      .select('extracted_data, created_at')
      .eq('user_id', user_id)
      .not('extracted_data', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20);

    const depthInsightTexts = (depthInsights || [])
      .map(m => m.extracted_data?.depth_insight)
      .filter(Boolean);

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
          : (typeof s.wins === 'string' ? s.wins : '');
        const misses = Array.isArray(s.misses)
          ? s.misses.map((m) => (typeof m === 'string' ? m : m?.text)).filter(Boolean).join('; ')
          : (typeof s.misses === 'string' ? s.misses : '');
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
    const SYSTEM = `You are analyzing a person's real reflection session data to generate genuine psychological insights — not summaries, not affirmations, not generic coaching language.

You will receive:
- Their patterns (blockers and strengths with occurrence counts and dates)
- Their actual session history (summaries, wins, struggles, commitments, and any depth insights captured)
- Their profile (identity, goal, why)
- \`depth_insights\` — these are the actual realizations users had during reflection sessions (e.g. "I avoid shipping because I'm afraid of being judged as average"). Use these as primary evidence when they exist. They are more direct than behavioral observations.

For each pattern, generate ONE insight paragraph. This is NOT a recap of what happened. It is an honest, specific analysis of what the pattern is, what function it's likely serving, and what the user can watch for in themselves going forward.

Requirements:
- Name the underlying mechanism, not just the behavior. "Perfectionism" is a label — what IS it actually doing? (e.g. "keeping work private until it's guaranteed to be received well, which means it never ships")
- Use SPECIFIC evidence from their session data — actual dates, actual quotes, actual commitments they made or broke
- Explain what the pattern might be protecting them from or helping them avoid — be honest, not clinical
- Give the user one specific thing to NOTICE about themselves going forward — not "try X", but "watch for the moment when Y" — this is metacognitive awareness, not advice
- Do NOT use phrases like: "it's worth sitting with", "it's a signal", "that's not luck", "it's not random", "this shows growth", "you're making progress"
- Do NOT moralize or give unsolicited advice on what to change
- Write in second person ("you", "your")
- 4-6 sentences per pattern. Be substantive. Don't pad.
- Use their actual words from session data when possible
- Blockers: be unflinching but not harsh — name what you see plainly, show where it appeared, describe what it costs them, and what to watch for
- Strengths: show trajectory — "a month ago... now..." — be specific about what they actually did, not generic praise
- If there is genuinely not enough data to say anything specific about a pattern, omit it rather than being generic

Return ONLY valid JSON:
{
  "narratives": [
    {
      "label": "<pattern label>",
      "type": "<blocker|strength|theme>",
      "occurrences": <number>,
      "narrative": "<your 4-6 sentence insight>",
      "watch_for": "<one specific thing to notice — 1 sentence>"
    }
  ]
}`;

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
            depth_insights: depthInsightTexts.length > 0 ? depthInsightTexts : undefined,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 2000,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return res.status(200).json({ narratives: result.narratives || [] });
  } catch (err) {
    console.error('generate-pattern-narrative error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}