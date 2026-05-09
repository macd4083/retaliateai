import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function updateByCustomer(customerId, updates) {
  if (!customerId || !updates || Object.keys(updates).length === 0) return;
  const { error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('stripe_customer_id', customerId);
  if (error) throw error;
}

function asIsoTimestamp(unixTimestamp) {
  if (!unixTimestamp) return null;
  return new Date(unixTimestamp * 1000).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (_err) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await updateByCustomer(session.customer, {
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription || null,
          subscription_status: 'active',
        });
        break;
      }
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        await updateByCustomer(subscription.customer, {
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status || 'active',
          subscription_current_period_end: asIsoTimestamp(subscription.current_period_end),
        });
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await updateByCustomer(subscription.customer, {
          subscription_status: subscription.status || 'active',
          subscription_current_period_end: asIsoTimestamp(subscription.current_period_end),
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await updateByCustomer(subscription.customer, {
          subscription_status: 'canceled',
        });
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const periodEnd =
          invoice.lines?.data?.[0]?.period?.end || invoice.period_end || null;
        await updateByCustomer(invoice.customer, {
          subscription_current_period_end: asIsoTimestamp(periodEnd),
        });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await updateByCustomer(invoice.customer, {
          subscription_status: 'past_due',
        });
        break;
      }
      case 'payment_method.attached':
      case 'payment_method.updated':
        break;
      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Webhook handling failed' });
  }
}
