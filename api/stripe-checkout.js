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
    const { user_id, email, display_name } = req.body || {};
    if (!user_id || !email) {
      return res.status(400).json({ error: 'user_id and email are required' });
    }
    if (user_id !== authenticatedUserId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', user_id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    let customerId = profile?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: display_name || undefined,
      });
      customerId = customer.id;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user_id);

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: 'https://retaliateai.com/settings?checkout=success',
      cancel_url: 'https://retaliateai.com/settings',
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to create checkout session' });
  }
}
