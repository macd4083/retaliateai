/**
 * api/goal-commitment-stats.js
 *
 * Returns per-goal follow-through stats from goal_commitment_log.
 * Used by both the coach context loader and the Insights page.
 *
 * POST { user_id, client_local_date? }
 *
 * Returns:
 *   per_goal: [
 *     {
 *       goal_id: string | null,
 *       rate_last_14: number | null,    // 0.0–1.0, null if < 3 evaluable
 *       trajectory: "improving" | "declining" | "stable",
 *       kept_last_14: number,
 *       total_last_14: number,
 *       days_since_last_commitment: number | null
 *     }
 *   ]
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, client_local_date } = req.body || {};
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const todayDate = client_local_date || todayStr();
    const sinceDate = addDays(todayDate, -14);
    const midpoint = addDays(todayDate, -7);

    const { data: logs } = await supabase
      .from('goal_commitment_log')
      .select('goal_id, date, kept')
      .eq('user_id', user_id)
      .gte('date', sinceDate)
      .lte('date', todayDate)
      .not('kept', 'is', null);

    if (!logs || logs.length === 0) {
      return res.status(200).json({ per_goal: [] });
    }

    // Group by goal_id
    const byGoal = {};
    for (const log of logs) {
      const gid = log.goal_id || '__unlinked__';
      if (!byGoal[gid]) byGoal[gid] = { kept: 0, total: 0, dates: [] };
      byGoal[gid].total++;
      if (log.kept) byGoal[gid].kept++;
      byGoal[gid].dates.push(log.date);
    }

    const per_goal = Object.entries(byGoal).map(([goalId, stats]) => {
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
        if (recentRate - priorRate > 0.1) trajectory = 'improving';
        else if (priorRate - recentRate > 0.1) trajectory = 'declining';
      }

      const sortedDates = [...stats.dates].sort();
      const lastDate = sortedDates[sortedDates.length - 1];
      const days_since_last_commitment = lastDate
        ? Math.floor((new Date(todayDate) - new Date(lastDate)) / 86400000)
        : null;

      return {
        goal_id: goalId === '__unlinked__' ? null : goalId,
        rate_last_14: stats.total >= 3 ? stats.kept / stats.total : null,
        trajectory,
        kept_last_14: stats.kept,
        total_last_14: stats.total,
        days_since_last_commitment,
      };
    });

    return res.status(200).json({ per_goal });
  } catch (err) {
    console.error('goal-commitment-stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
