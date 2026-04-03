/**
 * api/generate-pattern-narrative.js
 *
 * Generates narrative insights for the "What We've Noticed" section of InsightsV2.
 *
 * POST { user_id }
 *
 * Returns:
 *   narratives: [{ type: "blocker"|"strength"|"pattern", label, narrative, occurrences, watch_for }]
 *
 * Phase 2.3: Reads from `user_insights` (is_active = true) as the primary source.
 * Delegates regeneration to `api/synthesize-insights` when the cache is stale
 * (older than 3 days or session count has grown). Falls back to raw
 * `reflection_patterns` labels for users who have no synthesized insights yet.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NARRATIVE_CACHE_DAYS = 3;

/** Map a user_insights row to the narrative shape the InsightsV2 page expects. */
function insightToNarrative(ins) {
  return {
    label: ins.pattern_label || 'Insight',
    type: ins.pattern_type || 'pattern',
    occurrences: ins.sessions_synthesized_from || 0,
    narrative: ins.pattern_narrative || '',
    watch_for: ins.trigger_context || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.body || {};
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    // ── 0. Read active user_insights rows (new per-row schema) ────────────
    const [{ data: activeInsights }, { count: currentSessionCount }] = await Promise.all([
      supabase
        .from('user_insights')
        .select('id, pattern_label, pattern_type, pattern_narrative, trigger_context, sessions_synthesized_from, synthesized_at, confidence_score')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .order('confidence_score', { ascending: false })
        .limit(7),
      supabase
        .from('reflection_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .eq('is_complete', true),
    ]);

    const sessionCount = currentSessionCount || 0;

    // ── 1. Return cached insights if still fresh ──────────────────────────
    if (activeInsights && activeInsights.length > 0) {
      const mostRecent = activeInsights.reduce((a, b) =>
        new Date(a.synthesized_at) > new Date(b.synthesized_at) ? a : b
      );
      const ageDays = (Date.now() - new Date(mostRecent.synthesized_at).getTime()) / 86400000;
      const cachedSessionCount = mostRecent.sessions_synthesized_from || 0;

      if (ageDays < NARRATIVE_CACHE_DAYS && cachedSessionCount >= sessionCount) {
        return res.status(200).json({
          narratives: activeInsights.map(insightToNarrative),
          cached: true,
        });
      }
    }

    // ── 2. Load reflection_patterns as additive fallback data ─────────────
    const { data: patterns } = await supabase
      .from('reflection_patterns')
      .select('label, occurrence_count, pattern_type')
      .eq('user_id', user_id)
      .gte('occurrence_count', 2)
      .order('occurrence_count', { ascending: false })
      .limit(6);

    // ── 3. Delegate synthesis to synthesize-insights endpoint ─────────────
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';
      const synthRes = await fetch(`${baseUrl}/api/synthesize-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id, force_refresh: true }),
      });

      if (synthRes.ok) {
        const synthData = await synthRes.json();
        if (synthData.insights && synthData.insights.length > 0) {
          return res.status(200).json({
            narratives: synthData.insights.map(insightToNarrative),
          });
        }
      }
    } catch (_e) {
      // synthesis call failed — fall through to return what we have
    }

    // ── 4. Fallback: return stale insights rather than nothing ────────────
    if (activeInsights && activeInsights.length > 0) {
      return res.status(200).json({
        narratives: activeInsights.map(insightToNarrative),
        cached: true,
      });
    }

    // ── 5. Fallback: raw reflection_patterns labels (additive, pre-synthesis)
    if (patterns && patterns.length > 0) {
      return res.status(200).json({
        narratives: patterns.map((p) => ({
          label: p.label,
          type: p.pattern_type || 'pattern',
          occurrences: p.occurrence_count,
          narrative: '',
          watch_for: null,
        })),
      });
    }

    return res.status(200).json({ narratives: [] });
  } catch (err) {
    console.error('generate-pattern-narrative error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}