/**
 * api/commitment-stats.js
 *
 * Computes follow-through rate, trajectory, and recovery stats for a user.
 *
 * POST { user_id }
 *
 * Returns:
 *   followThrough7:      { kept, total } — commitments kept in the last 7 days
 *   followThroughPrior7: { kept, total } — commitments kept in days 8–14
 *   trajectory:          "improving" | "declining" | "stable"
 *   recoveryDays:        longest gap (missed days) between sessions in last 30 days
 *   recoveriesCount:     number of times user missed ≥1 day and came back
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Return YYYY-MM-DD string for today (server UTC, acceptable for relative window math)
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Add n days to a YYYY-MM-DD string and return a new YYYY-MM-DD string
function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Absolute day difference between two YYYY-MM-DD strings
function diffDays(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round(Math.abs(db - da) / 86400000);
}

// Return the Monday of the ISO week containing dateStr (Mon = week start)
function getMondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(y, m - 1, d - offset);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

// Format a YYYY-MM-DD date as "Mon D" (e.g. "Mar 10")
function formatWeekLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Compute follow-through for a window of sessions.
 *
 * windowSessions:    sessions within the window, sorted by date ascending
 * allSessionsByDate: map of date -> session for ALL loaded sessions (used for next-day lookups)
 *
 * A commitment on day N is "kept" if the session on day N+1 exists and is_complete === true.
 * The most recent session with a commitment in the window is excluded from the denominator
 * because its "next day" may not have happened yet.
 */
function computeFollowThrough(windowSessions, allSessionsByDate) {
  const withCommitment = windowSessions.filter((s) => !!s.tomorrow_commitment);
  if (withCommitment.length === 0) return { kept: 0, total: 0 };

  // Exclude the most recent session with a commitment from evaluation
  const evaluable = withCommitment.slice(0, -1);
  if (evaluable.length === 0) return { kept: 0, total: 0 };

  let kept = 0;
  for (const s of evaluable) {
    const nextDay = addDays(s.date, 1);
    if (allSessionsByDate[nextDay]?.is_complete) {
      kept++;
    }
  }
  return { kept, total: evaluable.length };
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
    const today = todayStr();
    const day7ago = addDays(today, -7);
    const day14ago = addDays(today, -14);
    const day30ago = addDays(today, -30);
    const thisMonday = getMondayOf(today);
    const weekStart8ago = addDays(thisMonday, -7 * 7); // Monday 7 weeks before current week

    // Fetch last 14 days of sessions for follow-through computation
    const { data: sessions14 } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user_id)
      .gte('date', day14ago)
      .lte('date', today)
      .order('date', { ascending: true });

    // Fetch last 30 days of completed sessions for recovery stats
    const { data: sessions30 } = await supabase
      .from('reflection_sessions')
      .select('date, is_complete')
      .eq('user_id', user_id)
      .gte('date', day30ago)
      .lte('date', today)
      .order('date', { ascending: true });

    const allSessions = sessions14 || [];

    // Build a date → session map covering all 14 days (for next-day lookups)
    const allSessionsByDate = {};
    for (const s of allSessions) {
      allSessionsByDate[s.date] = s;
    }

    // Split into two windows (strictly greater-than so each window is exactly 7 days)
    const last7 = allSessions.filter((s) => s.date > day7ago);
    const prior7 = allSessions.filter((s) => s.date > day14ago && s.date <= day7ago);

    const followThrough7 = computeFollowThrough(last7, allSessionsByDate);
    const followThroughPrior7 = computeFollowThrough(prior7, allSessionsByDate);

    // Trajectory — compare rates (ignore if either window has no data)
    const rate7 = followThrough7.total > 0 ? followThrough7.kept / followThrough7.total : null;
    const ratePrior = followThroughPrior7.total > 0 ? followThroughPrior7.kept / followThroughPrior7.total : null;

    let trajectory = 'stable';
    if (rate7 !== null && ratePrior !== null) {
      if (rate7 - ratePrior > 0.1) trajectory = 'improving';
      else if (ratePrior - rate7 > 0.1) trajectory = 'declining';
    }

    // Recovery stats — gaps between completed sessions in last 30 days
    const completedDates = (sessions30 || [])
      .filter((s) => s.is_complete)
      .map((s) => s.date);

    let recoveryDays = 0;
    let recoveriesCount = 0;

    for (let i = 1; i < completedDates.length; i++) {
      const gap = diffDays(completedDates[i - 1], completedDates[i]);
      if (gap > 1) {
        recoveriesCount++;
        const missedDays = gap - 1;
        if (missedDays > recoveryDays) recoveryDays = missedDays;
      }
    }

    // Weekly sparkline data: 8 calendar weeks (Mon–Sun), oldest→newest
    const { data: sessions8w } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user_id)
      .gte('date', weekStart8ago)
      .lte('date', today)
      .order('date', { ascending: true });

    const all8wSessions = sessions8w || [];
    const all8wByDate = {};
    for (const s of all8wSessions) {
      all8wByDate[s.date] = s;
    }

    const weeklyData = [];
    for (let i = 7; i >= 0; i--) {
      const wStart = addDays(thisMonday, -i * 7);
      const wEnd = addDays(wStart, 6);
      const wSessions = all8wSessions.filter((s) => s.date >= wStart && s.date <= wEnd);
      const { kept, total } = computeFollowThrough(wSessions, all8wByDate);
      weeklyData.push({
        weekLabel: formatWeekLabel(wStart),
        kept,
        total,
        rate: total > 0 ? Math.round((kept / total) * 1000) / 1000 : null,
      });
    }

    return res.status(200).json({
      followThrough7,
      followThroughPrior7,
      trajectory,
      recoveryDays,
      recoveriesCount,
      weeklyData,
    });
  } catch (err) {
    console.error('commitment-stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
