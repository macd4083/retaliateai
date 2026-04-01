/**
 * api/evaluate-goal-commitments.js
 *
 * Marks goal commitments as kept or missed.
 * Called when a session completes (or can be called independently).
 *
 * POST { user_id, session_date }
 *
 * Logic:
 *   - For goal_commitment_log rows where date = session_date - 1 and kept IS NULL:
 *     if a completed session exists for session_date → mark kept = true
 *   - For rows where date < session_date - 1 and kept IS NULL (2+ days old):
 *     mark kept = false (they'll never get a session)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, session_date } = req.body || {};
  if (!user_id || !session_date) {
    return res.status(400).json({ error: 'user_id and session_date are required' });
  }

  try {
    const yesterday = addDays(session_date, -1);
    const twoDaysAgo = addDays(session_date, -2);
    const now = new Date().toISOString();

    // Check if a completed session exists for session_date
    const { data: completedSession } = await supabase
      .from('reflection_sessions')
      .select('id')
      .eq('user_id', user_id)
      .eq('date', session_date)
      .eq('is_complete', true)
      .maybeSingle();

    // Mark yesterday's pending commitments as kept if today's session is complete
    if (completedSession) {
      const { data: pendingLogs } = await supabase
        .from('goal_commitment_log')
        .select('id')
        .eq('user_id', user_id)
        .eq('date', yesterday)
        .is('kept', null);

      if (pendingLogs && pendingLogs.length > 0) {
        await supabase
          .from('goal_commitment_log')
          .update({ kept: true, evaluated_at: now })
          .eq('user_id', user_id)
          .eq('date', yesterday)
          .is('kept', null);
      }
    }

    // Mark commitments from 2+ days ago that are still null as missed
    await supabase
      .from('goal_commitment_log')
      .update({ kept: false, evaluated_at: now })
      .eq('user_id', user_id)
      .lt('date', twoDaysAgo)
      .is('kept', null);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('evaluate-goal-commitments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
