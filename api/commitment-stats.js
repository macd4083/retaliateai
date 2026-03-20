/**
 * api/commitment-stats.js
 *
 * Computes follow-through rate, trajectory, and recovery stats for a user.
 *
 * POST { user_id, client_local_date? }
 *
 * Returns:
 *   followThrough7:      { kept, total } — commitments kept in the last 7 calendar days
 *   followThroughPrior7: { kept, total } — commitments kept in days 8–14
 *   trajectory:          "improving" | "declining" | "stable"
 *   recoveryDays:        longest gap (missed days) between sessions in last 30 days
 *   recoveriesCount:     number of times user missed ≥1 day and came back
 *   weeklyData:          array of { weekLabel, kept, total, rate } — 8 weeks, oldest→newest
 *                        total is always 7 (days in the week), kept = how many commitments were followed through
 *   thisWeekKept:        commitments kept so far this calendar week (Mon–today)
 *   thisWeekTotal:       commitments made+evaluable so far this calendar week
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Return YYYY-MM-DD string for today (server UTC)
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
 *
 * FIX: The most recent session with a commitment is only excluded from evaluation
 * if the next day does NOT yet have a completed session. If the next day's session
 * already exists and is complete, we count it — this fixes the Sunday-morning
 * scenario where yesterday's commitment should score.
 */
function computeFollowThrough(windowSessions, allSessionsByDate) {
  const withCommitment = windowSessions.filter((s) => !!s.tomorrow_commitment);
  if (withCommitment.length === 0) return { kept: 0, total: 0 };

  let kept = 0;
  let total = 0;

  for (let idx = 0; idx < withCommitment.length; idx++) {
    const s = withCommitment[idx];
    const nextDay = addDays(s.date, 1);
    const nextSession = allSessionsByDate[nextDay];
    const isLastInWindow = idx === withCommitment.length - 1;

    if (isLastInWindow && !nextSession?.is_complete) {
      // Most recent commitment and next day hasn't been completed yet — skip (pending)
      continue;
    }

    // Either it's not the last, OR the next day already has a completed session
    total++;
    if (nextSession?.is_complete) kept++;
  }

  return { kept, total };
}

/**
 * Compute kept count out of a fixed denominator of 7 for the consistency graph.
 * This makes every week comparable: 7/7 is perfect, 0/7 is zero.
 * We count how many days in the week had a commitment that was followed through.
 */
function computeWeeklyKeptOutOf7(wSessions, allSessionsByDate) {
  let kept = 0;
  for (const s of wSessions) {
    if (!s.tomorrow_commitment) continue;
    const nextDay = addDays(s.date, 1);
    if (allSessionsByDate[nextDay]?.is_complete) kept++;
  }
  return { kept, total: 7 };
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
    const today = client_local_date || todayStr();
    const day14ago = addDays(today, -14);
    const day30ago = addDays(today, -30);
    const thisMonday = getMondayOf(today);
    const weekStart8ago = addDays(thisMonday, -7 * 7); // Monday 7 full weeks before current week start

    // ── Fetch last 15 days (14 + 1 for next-day lookups) ─────────────────
    const { data: sessions15 } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user_id)
      .gte('date', addDays(day14ago, -1)) // one extra day for next-day lookup on the oldest
      .lte('date', addDays(today, 1))     // include tomorrow in case someone reflects tonight and we need it
      .order('date', { ascending: true });

    const allSessions14 = (sessions15 || []).filter((s) => s.date >= day14ago && s.date <= today);

    // Build a date → session map for all fetched sessions (for next-day lookups)
    const allSessionsByDate = {};
    for (const s of sessions15 || []) {
      allSessionsByDate[s.date] = s;
    }

    // ── Rolling 7-day windows (calendar days, not evaluable count) ────────
    // last7: sessions from (today-6) to today inclusive — i.e. current 7-day rolling window
    const day6ago = addDays(today, -6);
    const day7ago = addDays(today, -7);

    const last7 = allSessions14.filter((s) => s.date >= day6ago && s.date <= today);
    const prior7 = allSessions14.filter((s) => s.date >= day14ago && s.date <= day7ago);

    const followThrough7 = computeFollowThrough(last7, allSessionsByDate);
    const followThroughPrior7 = computeFollowThrough(prior7, allSessionsByDate);

    // Trajectory — compare rates (ignore if either window has insufficient data)
    const rate7 = followThrough7.total > 0 ? followThrough7.kept / followThrough7.total : null;
    const ratePrior = followThroughPrior7.total > 0 ? followThroughPrior7.kept / followThroughPrior7.total : null;

    let trajectory = 'stable';
    if (rate7 !== null && ratePrior !== null) {
      if (rate7 - ratePrior > 0.1) trajectory = 'improving';
      else if (ratePrior - rate7 > 0.1) trajectory = 'declining';
    }

    // ── Recovery stats — gaps between completed sessions in last 30 days ──
    const { data: sessions30 } = await supabase
      .from('reflection_sessions')
      .select('date, is_complete')
      .eq('user_id', user_id)
      .gte('date', day30ago)
      .lte('date', today)
      .order('date', { ascending: true });

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

    // ── Weekly sparkline data: 8 calendar weeks (Mon–Sun), oldest→newest ──
    // Each week's "kept" is raw days where commitment was followed through.
    // "total" is always 7 so the graph is always out of 7.
    const { data: sessions8w } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user_id)
      .gte('date', weekStart8ago)
      .lte('date', addDays(today, 1)) // include tomorrow for next-day lookups on Sunday
      .order('date', { ascending: true });

    const all8wSessions = sessions8w || [];
    const all8wByDate = {};
    for (const s of all8wSessions) {
      all8wByDate[s.date] = s;
    }

    const weeklyData = [];
    // Loop: i=7 (oldest, 7 weeks ago) down to i=0 (current week) = 8 weeks total
    for (let i = 7; i >= 0; i--) {
      const wStart = addDays(thisMonday, -i * 7);
      const wEnd = addDays(wStart, 6);
      const wSessions = all8wSessions.filter((s) => s.date >= wStart && s.date <= wEnd);
      const { kept } = computeWeeklyKeptOutOf7(wSessions, all8wByDate);
      weeklyData.push({
        weekLabel: formatWeekLabel(wStart),
        kept,
        total: 7,
        rate: kept / 7,
      });
    }

    // ── This week's half-circle gauge (Mon through today) ─────────────────
    // Shows commitments made THIS week (Mon–Sun) and how many were kept.
    // "total" = evaluable commitments this week (excludes pending most-recent).
    // "kept" = how many of those were followed through.
    const thisWeekSessions = all8wSessions.filter(
      (s) => s.date >= thisMonday && s.date <= today
    );
    const thisWeekStats = computeFollowThrough(thisWeekSessions, all8wByDate);

    return res.status(200).json({
      followThrough7,
      followThroughPrior7,
      trajectory,
      recoveryDays,
      recoveriesCount,
      weeklyData,
      thisWeekKept: thisWeekStats.kept,
      thisWeekTotal: thisWeekStats.total,
    });
  } catch (err) {
    console.error('commitment-stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}