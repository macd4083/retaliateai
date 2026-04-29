/**
 * api/synthesize-insights.js
 *
 * Persistent insight synthesis endpoint.
 * Uses goal commitment data and session causal extracts to synthesize 5-7 insights.
 * Replaces the prior session_history + profile pipeline.
 *
 * POST { user_id, force_refresh? }
 *
 * Called:
 *   - After every completed session (fire-and-forget from reflection-coach.js)
 *   - On InsightsV2 load if newest synthesized_at > 3 days old
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYNTHESIS_CACHE_DAYS = 3;
const MAX_ACTIVE_INSIGHTS = 7;
const MIN_SESSIONS = 3;

function insightToNarrative(ins) {
  return {
    label: ins.pattern_label || 'Insight',
    type: ins.pattern_type || 'pattern',
    occurrences: ins.sessions_synthesized_from || 0,
    first_seen_date: ins.first_seen_date || null,
    last_seen_date: ins.last_seen_date || null,
  };
}

const SYNTHESIS_SYSTEM = `You are analyzing a person's behavioral data to synthesize 5–7 genuine insights about patterns actively shaping their follow-through and motivation.

You will receive:
- active_goals: array of goals with their why history, commitment follow-through rates, and depth insights
- win_causes: what they said drove their wins over the last 30 days (their actual words)
- miss_causes: what they said got in the way over the last 30 days (their actual words)
- existing_tracked_insights: current insights to update rather than duplicate

For each insight produce:
- pattern_label: 3–5 words describing the pattern (e.g. "Commitment drops mid-week", "Wins tied to morning routine")
- pattern_type: "blocker" | "strength" | "identity_theme"
- evidence: one specific sentence citing actual data — commitment rates, their actual words from win/miss causes, goal-specific patterns. Never generic.
- unlocked_practices: applicable exercise IDs from: ["ownership_reframe","gratitude_anchor","why_reconnect","evidence_audit","implementation_intention","values_clarification","future_self_bridge","triage_one_thing","identity_reinforcement","depth_probe"]
- confidence_score: 0.0–1.0
- existing_insight_id: UUID of existing insight this updates, or null

RULES:
- Derive patterns from behavioral evidence (commitment kept/missed rates, what they said caused wins/misses)
- If a goal has <40% follow-through rate, that's a blocker insight
- If win_causes show a recurring theme (same thing mentioned 3+ times), that's a strength insight
- If miss_causes show a recurring theme, that's a blocker insight
- Use their actual words from win_causes/miss_causes in the evidence field
- Never use abstract psychological language
- Update existing insights rather than duplicating them
- Max 7 insights. Fewer is fine if not enough evidence.
- For each insight's unlocked_practices: only include exercise IDs the user has NOT yet run (not in exercises_already_explained). If all applicable exercises are already explained, return an empty array.

Return ONLY valid JSON:
{
  "insights": [
    {
      "existing_insight_id": "<uuid or null>",
      "pattern_label": "...",
      "pattern_type": "blocker|strength|identity_theme",
      "evidence": "...",
      "unlocked_practices": ["..."],
      "confidence_score": 0.0
    }
  ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let authenticatedUserId;
  try {
    authenticatedUserId = await getAuthenticatedUserId(req);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const { force_refresh = false, return_as_narratives = false, user_id: requestedUserId = null } = req.body || {};
  const targetUserId = requestedUserId || authenticatedUserId;
  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    if (return_as_narratives) {
      const [{ data: activeInsights }, { count: currentSessionCount }] = await Promise.all([
        supabase
          .from('user_insights')
          .select('id, pattern_label, pattern_type, sessions_synthesized_from, synthesized_at, confidence_score, first_seen_date, last_seen_date')
          .eq('user_id', targetUserId)
          .eq('is_active', true)
          .order('confidence_score', { ascending: false })
          .limit(MAX_ACTIVE_INSIGHTS),
        supabase
          .from('reflection_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', targetUserId)
          .eq('is_complete', true),
      ]);

      const sessionCount = currentSessionCount || 0;
      if (activeInsights && activeInsights.length > 0) {
        const mostRecent = activeInsights.reduce((a, b) =>
          new Date(a.synthesized_at) > new Date(b.synthesized_at) ? a : b
        );
        const ageDays = (Date.now() - new Date(mostRecent.synthesized_at).getTime()) / 86400000;
        const cachedSessionCount = mostRecent.sessions_synthesized_from || 0;
        if (ageDays < SYNTHESIS_CACHE_DAYS && cachedSessionCount >= sessionCount) {
          return res.status(200).json({
            narratives: activeInsights.map(insightToNarrative),
            cached: true,
          });
        }
      }
    }

    const effectiveForceRefresh = return_as_narratives ? true : force_refresh;

    // ── 0. Cache check ────────────────────────────────────────────────────
    if (!effectiveForceRefresh) {
      const { data: recent } = await supabase
        .from('user_insights')
        .select('synthesized_at')
        .eq('user_id', targetUserId)
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
            .eq('user_id', targetUserId)
            .eq('is_active', true)
            .order('confidence_score', { ascending: false })
            .limit(MAX_ACTIVE_INSIGHTS);
          if (return_as_narratives) {
            return res.status(200).json({ narratives: (cached || []).map(insightToNarrative), cached: true });
          }
          return res.status(200).json({ insights: cached || [], cached: true });
        }
      }
    }

    // ── 1. Check minimum session count ────────────────────────────────────
    const { count: sessionCount } = await supabase
      .from('reflection_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', targetUserId)
      .eq('is_complete', true);

    if (!sessionCount || sessionCount < MIN_SESSIONS) {
      if (return_as_narratives) {
        return res.status(200).json({ narratives: [], message: `Need at least ${MIN_SESSIONS} sessions.` });
      }
      return res.status(200).json({ insights: [], message: `Need at least ${MIN_SESSIONS} sessions.` });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // ── 2. Load active goals with commitment stats ─────────────────────────
    const [
      { data: activeGoals },
      { data: commitmentLog },
      { data: causalExtracts },
      { data: existingInsights },
      { data: profileData },
    ] = await Promise.all([
      supabase
        .from('goals')
        .select('id, title, whys, why_summary, depth_insights, last_mentioned_at, last_motivation_signal')
        .eq('user_id', targetUserId)
        .eq('status', 'active'),
      supabase
        .from('goal_commitment_log')
        .select('goal_id, commitment_text, kept, date')
        .eq('user_id', targetUserId)
        .gte('date', thirtyDaysAgo)
        .order('date', { ascending: false }),
      supabase
        .from('session_causal_extracts')
        .select('id, type, raw_text, goal_id, date')
        .eq('user_id', targetUserId)
        .gte('date', thirtyDaysAgo)
        .order('date', { ascending: false }),
      supabase
        .from('user_insights')
        .select('id, pattern_label, pattern_type, synthesized_at, confidence_score, last_seen_date')
        .eq('user_id', targetUserId)
        .eq('is_active', true)
        .order('synthesized_at', { ascending: false })
        .limit(MAX_ACTIVE_INSIGHTS),
      supabase
        .from('user_profiles')
        .select('exercises_explained')
        .eq('id', targetUserId)
        .maybeSingle(),
    ]);

    // ── 3. Clean up causal extracts older than 30 days (fire-and-forget) ──
    supabase
      .from('session_causal_extracts')
      .delete()
      .eq('user_id', targetUserId)
      .lt('date', thirtyDaysAgo)
      .then(() => {}).catch(() => {});

    const exercisesExplained = profileData?.exercises_explained || [];

    // ── 4. Build goal context with commitment stats ───────────────────────
    const goalContext = (activeGoals || []).map(goal => {
      const goalCommitments = (commitmentLog || []).filter(c => c.goal_id === goal.id);
      const kept = goalCommitments.filter(c => c.kept === true).length;
      const missed = goalCommitments.filter(c => c.kept === false).length;
      const total = kept + missed;
      const followThroughRate = total > 0 ? Math.round((kept / total) * 100) : null;

      return {
        id: goal.id,
        title: goal.title,
        whys: (goal.whys || []).slice(-3).map(w => w.text || w),
        why_summary: goal.why_summary || null,
        depth_insights: (goal.depth_insights || []).slice(-3).map(d => d.insight || d),
        last_mentioned_at: goal.last_mentioned_at,
        motivation_signal: goal.last_motivation_signal,
        commitment_follow_through_rate: followThroughRate,
        total_commitments_tracked: total,
        recent_commitments: goalCommitments.slice(0, 5).map(c => ({
          text: c.commitment_text,
          kept: c.kept,
          date: c.date,
        })),
      };
    });

    const winCauses = (causalExtracts || []).filter(e => e.type === 'win_cause').map(e => ({
      text: e.raw_text,
      date: e.date,
      goal_id: e.goal_id,
    }));

    const missCauses = (causalExtracts || []).filter(e => e.type === 'miss_cause').map(e => ({
      text: e.raw_text,
      date: e.date,
      goal_id: e.goal_id,
    }));

    // ── 5. Call GPT-4o ────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYNTHESIS_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            active_goals: goalContext.length > 0 ? goalContext : undefined,
            win_causes: winCauses.length > 0 ? winCauses : undefined,
            miss_causes: missCauses.length > 0 ? missCauses : undefined,
            existing_tracked_insights: (existingInsights || []).length > 0
              ? (existingInsights || []).map((i) => ({ id: i.id, label: i.pattern_label, type: i.pattern_type, last_synthesized: i.synthesized_at, confidence: i.confidence_score }))
              : undefined,
            exercises_already_explained: exercisesExplained.length > 0 ? exercisesExplained : undefined,
            total_sessions_analyzed: sessionCount,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 3500,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const newInsights = (result.insights || []).slice(0, MAX_ACTIVE_INSIGHTS);

    if (newInsights.length === 0) {
      if (return_as_narratives) {
        return res.status(200).json({ narratives: [], message: 'No clear patterns found yet.' });
      }
      return res.status(200).json({ insights: [], message: 'No clear patterns found yet.' });
    }

    const now = new Date().toISOString();
    const todayDate = now.slice(0, 10);
    const upsertedIds = new Set();

    // ── 6. Upsert insights ────────────────────────────────────────────────
    for (const insight of newInsights) {
      const row = {
        user_id: targetUserId,
        pattern_label: insight.pattern_label,
        pattern_type: insight.pattern_type,
        unlocked_practices: insight.unlocked_practices || [],
        confidence_score: typeof insight.confidence_score === 'number' ? insight.confidence_score : 0.5,
        sessions_synthesized_from: sessionCount,
        synthesized_at: todayDate,
        last_updated_at: now,
        last_seen_date: todayDate,
        is_active: true,
      };

      if (insight.existing_insight_id) {
        const { data: updated } = await supabase
          .from('user_insights')
          .update(row)
          .eq('id', insight.existing_insight_id)
          .eq('user_id', targetUserId)
          .select('id')
          .maybeSingle();
        if (updated?.id) upsertedIds.add(updated.id);
      } else {
        const { data: inserted } = await supabase
          .from('user_insights')
          .insert({ ...row, first_seen_date: todayDate })
          .select('id')
          .maybeSingle();
        if (inserted?.id) upsertedIds.add(inserted.id);
      }
    }

    // ── 7. Update last_seen_in_insight on contributing causal extracts ────
    if (upsertedIds.size > 0 && (causalExtracts || []).length > 0) {
      const extractIds = (causalExtracts || []).map(e => e.id).filter(Boolean);
      if (extractIds.length > 0) {
        supabase
          .from('session_causal_extracts')
          .update({ last_seen_in_insight: todayDate })
          .eq('user_id', targetUserId)
          .in('id', extractIds)
          .then(() => {}).catch(() => {});
      }
    }

    // ── 8. Retire stale insights (15-day rule) ────────────────────────────
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
    const toRetire = (existingInsights || [])
      .filter(i => !upsertedIds.has(i.id) && (i.last_seen_date || i.synthesized_at) < fifteenDaysAgo)
      .map(i => i.id);

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
      .eq('user_id', targetUserId)
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(MAX_ACTIVE_INSIGHTS);

    if (return_as_narratives) {
      return res.status(200).json({ narratives: (fresh || []).map(insightToNarrative) });
    }
    return res.status(200).json({ insights: fresh || [] });
  } catch (err) {
    console.error('synthesize-insights error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
