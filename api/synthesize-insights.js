/**
 * api/synthesize-insights.js
 *
 * Persistent insight synthesis endpoint.
 * Reads last 30 sessions + depth insights, synthesizes 5-7 insights via GPT-4o,
 * and writes them as individual rows to user_insights.
 *
 * POST { user_id, force_refresh? }
 *
 * Called:
 *   - After every completed session (fire-and-forget from reflection-coach.js)
 *   - On InsightsV2 load if newest synthesized_at > 3 days old
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYNTHESIS_CACHE_DAYS = 3;
const STALE_INSIGHT_DAYS = 14;
const MAX_ACTIVE_INSIGHTS = 7;
const MIN_SESSIONS = 3;

const SYNTHESIS_SYSTEM = `You are analyzing a person's real reflection session data to synthesize 5–7 genuine psychological insights about patterns actively shaping their behavior. These are NOT summaries. They are precise, evidence-based observations.

You will receive:
- Their last 30 sessions (dates, summaries, wins, struggles, blocker tags, commitments)
- Direct quotes/realizations from sessions (depth_insights)
- Their existing tracked insights (update rather than duplicate)
- Their profile (identity, goal, why, future self)

For each insight produce:
- pattern_narrative: 4–6 sentences, second person, SPECIFIC evidence (dates, quotes, actual events). Name the mechanism — what is the pattern doing/protecting/avoiding?
- trigger_context: The specific situation/internal state that activates this. One sentence.
- user_quote: Most revealing direct quote in their exact words. null if none.
- foothold: What is already shifting — evidence of change. null if nothing shifting yet.
- pattern_label: 3–5 words. e.g. "Shipping avoidance", "Accountability deflection"
- pattern_type: "blocker" | "strength" | "identity_theme"
- unlocked_practices: Applicable exercise IDs from: ["ownership_reframe","gratitude_anchor","why_reconnect","evidence_audit","implementation_intention","values_clarification","future_self_bridge","triage_one_thing","identity_reinforcement","depth_probe"]
- confidence_score: 0.0–1.0 based on session count, recency, and whether user acknowledged it
- existing_insight_id: UUID of existing insight this updates, or null

RULES:
- Max 7 insights. Fewer is fine if not enough evidence.
- Cite specific dates or events. If you cannot, omit.
- No generic coaching language. No "it's worth sitting with", "this shows growth".
- Second person throughout.
- Update existing insights rather than creating duplicates.

Return ONLY valid JSON:
{
  "insights": [
    {
      "existing_insight_id": "<uuid or null>",
      "pattern_label": "...",
      "pattern_type": "blocker|strength|identity_theme",
      "pattern_narrative": "...",
      "trigger_context": "...",
      "user_quote": "... or null",
      "foothold": "... or null",
      "unlocked_practices": ["..."],
      "confidence_score": 0.0
    }
  ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, force_refresh = false } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  try {
    // ── 0. Cache check ────────────────────────────────────────────────────
    if (!force_refresh) {
      const { data: recent } = await supabase
        .from('user_insights')
        .select('synthesized_at')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .order('synthesized_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent?.synthesized_at) {
        const ageDays = (Date.now() - new Date(recent.synthesized_at).getTime()) / 86400000;
        if (ageDays < SYNTHESIS_CACHE_DAYS) {
          const { data: cached } = await supabase
            .from('user_insights')
            .select('*')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .order('confidence_score', { ascending: false })
            .limit(MAX_ACTIVE_INSIGHTS);
          return res.status(200).json({ insights: cached || [], cached: true });
        }
      }
    }

    // ── 1. Load sessions ──────────────────────────────────────────────────
    const { data: sessions } = await supabase
      .from('reflection_sessions')
      .select('date, summary, wins, misses, tomorrow_commitment, mood_end_of_day, blocker_tags, checklist')
      .eq('user_id', user_id)
      .eq('is_complete', true)
      .order('date', { ascending: false })
      .limit(30);

    if (!sessions || sessions.length < MIN_SESSIONS) {
      return res.status(200).json({ insights: [], message: `Need at least ${MIN_SESSIONS} sessions.` });
    }

    // ── 2. Load depth insights ────────────────────────────────────────────
    const { data: depthMessages } = await supabase
      .from('reflection_messages')
      .select('extracted_data, created_at')
      .eq('user_id', user_id)
      .not('extracted_data', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(30);

    const depthInsights = (depthMessages || [])
      .map((m) => m.extracted_data?.depth_insight)
      .filter(Boolean);

    // ── 3. Load existing active insights ──────────────────────────────────
    const { data: existingInsights } = await supabase
      .from('user_insights')
      .select('id, pattern_label, pattern_type, pattern_narrative, synthesized_at, confidence_score')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .order('synthesized_at', { ascending: false })
      .limit(MAX_ACTIVE_INSIGHTS);

    // ── 4. Load profile ───────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('identity_statement, big_goal, why, future_self, values, short_term_state, long_term_patterns, strengths, growth_areas')
      .eq('id', user_id)
      .maybeSingle();

    // ── 5. Build GPT context ──────────────────────────────────────────────
    const sessionHistory = sessions.map((s) => {
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
      if (s.tomorrow_commitment) line += ` Committed: ${s.tomorrow_commitment}.`;
      return line;
    }).join('\n');

    const profileContext = [
      profile?.identity_statement ? `Identity: "${profile.identity_statement}"` : null,
      profile?.big_goal ? `Goal: "${profile.big_goal}"` : null,
      profile?.why ? `Why: "${profile.why}"` : null,
      profile?.future_self ? `Future self: "${profile.future_self}"` : null,
      profile?.values ? `Values: ${Array.isArray(profile.values) ? profile.values.join(', ') : profile.values}` : null,
      profile?.short_term_state ? `Current state: ${profile.short_term_state}` : null,
    ].filter(Boolean).join('\n');

    // ── 6. Call GPT-4o ────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYNTHESIS_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            session_history: sessionHistory,
            depth_insights: depthInsights.length > 0 ? depthInsights : undefined,
            existing_tracked_insights: (existingInsights || []).length > 0
              ? (existingInsights || []).map((i) => ({ id: i.id, label: i.pattern_label, type: i.pattern_type, last_synthesized: i.synthesized_at, confidence: i.confidence_score }))
              : undefined,
            profile: profileContext || 'No profile data yet.',
            total_sessions_analyzed: sessions.length,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 3000,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const newInsights = (result.insights || []).slice(0, MAX_ACTIVE_INSIGHTS);

    if (newInsights.length === 0) {
      return res.status(200).json({ insights: [], message: 'No clear patterns found yet.' });
    }

    const now = new Date().toISOString();
    const todayDate = now.slice(0, 10);
    const upsertedIds = new Set();

    // ── 7. Upsert insights ────────────────────────────────────────────────
    for (const insight of newInsights) {
      const row = {
        user_id,
        pattern_label: insight.pattern_label,
        pattern_type: insight.pattern_type,
        pattern_narrative: insight.pattern_narrative,
        trigger_context: insight.trigger_context || null,
        user_quote: insight.user_quote || null,
        foothold: insight.foothold || null,
        unlocked_practices: insight.unlocked_practices || [],
        confidence_score: typeof insight.confidence_score === 'number' ? insight.confidence_score : 0.5,
        sessions_synthesized_from: sessions.length,
        synthesized_at: todayDate,
        last_updated_at: now,
        is_active: true,
      };

      if (insight.existing_insight_id) {
        const { data: updated } = await supabase
          .from('user_insights')
          .update(row)
          .eq('id', insight.existing_insight_id)
          .eq('user_id', user_id)
          .select('id')
          .maybeSingle();
        if (updated?.id) upsertedIds.add(updated.id);
      } else {
        const { data: inserted } = await supabase
          .from('user_insights')
          .insert(row)
          .select('id')
          .maybeSingle();
        if (inserted?.id) upsertedIds.add(inserted.id);
      }
    }

    // ── 8. Retire stale insights not updated in this run ──────────────────
    const staleCutoff = new Date(Date.now() - STALE_INSIGHT_DAYS * 86400000).toISOString().slice(0, 10);
    const toRetire = (existingInsights || [])
      .filter((i) => !upsertedIds.has(i.id) && i.synthesized_at < staleCutoff)
      .map((i) => i.id);

    if (toRetire.length > 0) {
      await supabase
        .from('user_insights')
        .update({ is_active: false, last_updated_at: now })
        .in('id', toRetire);
    }

    // ── 9. Return fresh insights ──────────────────────────────────────────
    const { data: fresh } = await supabase
      .from('user_insights')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(MAX_ACTIVE_INSIGHTS);

    return res.status(200).json({ insights: fresh || [] });
  } catch (err) {
    console.error('synthesize-insights error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
