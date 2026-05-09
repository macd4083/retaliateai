import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    if (user_id !== authenticatedUserId) return res.status(403).json({ error: 'Forbidden' });

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_subscription_id')
      .eq('id', user_id)
      .maybeSingle();

    if (profileError) return res.status(500).json({ error: profileError.message });
    if (!profile?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active Stripe subscription found' });
    }

    const subscription = await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    const updates = {
      subscription_status: 'canceling',
      subscription_current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    };

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', user_id);

    if (updateError) return res.status(500).json({ error: updateError.message });

    return res.status(200).json({ success: true, cancel_at_period_end: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
  }
}
