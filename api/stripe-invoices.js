import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let authenticatedUserId;
  try {
    authenticatedUserId = await getAuthenticatedUserId(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

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
