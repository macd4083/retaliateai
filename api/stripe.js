import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = req.method === 'GET' ? req.query?.action : req.body?.action;
  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  if (action === 'invoices' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (action !== 'invoices' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let authenticatedUserId;
  try {
    authenticatedUserId = await getAuthenticatedUserId(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  if (action === 'checkout') {
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

  if (action === 'cancel') {
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

  if (action === 'update-payment') {
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

  if (action === 'invoices') {
    try {
      const user_id = req.query?.user_id;
      if (!user_id) return res.status(400).json({ error: 'user_id is required' });
      if (user_id !== authenticatedUserId) return res.status(403).json({ error: 'Forbidden' });

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('stripe_customer_id')
        .eq('id', user_id)
        .maybeSingle();

      if (profileError) return res.status(500).json({ error: profileError.message });
      if (!profile?.stripe_customer_id) return res.status(200).json([]);

      const invoices = await stripe.invoices.list({
        customer: profile.stripe_customer_id,
        limit: 12,
      });

      const payload = (invoices.data || []).map((invoice) => ({
        id: invoice.id,
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        created: invoice.created,
        invoice_pdf: invoice.invoice_pdf,
        hosted_invoice_url: invoice.hosted_invoice_url,
        period_start: invoice.lines?.data?.[0]?.period?.start || null,
        period_end: invoice.lines?.data?.[0]?.period?.end || null,
      }));

      return res.status(200).json(payload);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to fetch invoices' });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
