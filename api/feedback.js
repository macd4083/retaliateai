import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let authenticatedUserId;
  try {
    authenticatedUserId = await getAuthenticatedUserId(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  const q1 = typeof req.body?.q1 === 'string' ? req.body.q1.trim() : '';
  const q2 = typeof req.body?.q2 === 'string' ? req.body.q2.trim() : '';
  if (!q1 || !q2) {
    return res.status(400).json({ error: 'q1 and q2 are required' });
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('feedback_submitted, trial_extended')
      .eq('id', authenticatedUserId)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    if (profile?.feedback_submitted && profile?.trial_extended) {
      return res.status(403).json({ error: 'already_extended' });
    }

    const { error: insertError } = await supabase
      .from('user_feedback')
      .insert({
        user_id: authenticatedUserId,
        q1_favorite_least_favorite: q1,
        q2_whats_working: q2,
      });

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    const newTrialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        feedback_submitted: true,
        trial_extended: true,
        trial_ends_at: newTrialEndsAt,
      })
      .eq('id', authenticatedUserId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({ success: true, new_trial_ends_at: newTrialEndsAt });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to submit feedback' });
  }
}
