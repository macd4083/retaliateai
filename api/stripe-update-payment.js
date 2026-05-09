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
    const { user_id, payment_method_id } = req.body || {};
    if (!user_id || !payment_method_id) {
      return res.status(400).json({ error: 'user_id and payment_method_id are required' });
    }
    if (user_id !== authenticatedUserId) return res.status(403).json({ error: 'Forbidden' });

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', user_id)
      .maybeSingle();

    if (profileError) return res.status(500).json({ error: profileError.message });
    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found' });
    }

    await stripe.paymentMethods.attach(payment_method_id, {
      customer: profile.stripe_customer_id,
    });

    await stripe.customers.update(profile.stripe_customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });

    if (profile?.stripe_subscription_id) {
      await stripe.subscriptions.update(profile.stripe_subscription_id, {
        default_payment_method: payment_method_id,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to update payment method' });
  }
}
