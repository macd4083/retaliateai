import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'delivered@resend.dev';

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

function sanitizeSubject(text = '') {
  return String(text).replace(/[\r\n]+/g, ' ').trim();
}

function formatCurrency(amount = 0, currency = 'usd') {
  const trimmedCurrency = typeof currency === 'string' ? currency.trim() : '';
  const normalizedCurrency = trimmedCurrency.length === 3
    ? trimmedCurrency.toUpperCase()
    : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format((Number(amount) || 0) / 100);
  } catch (_err) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format((Number(amount) || 0) / 100);
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function getProfileByCustomer(customerId) {
  if (!customerId) return null;
  const { data } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data || null;
}

async function getEmailByUserId(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

async function sendEmail({ to, subject, html }) {
  if (!to) return;
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: sanitizeSubject(subject),
    html,
  });
  if (error) {
    console.error('stripe-webhook email send error', error);
  }
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
        const profile = await getProfileByCustomer(session.customer);
        const userEmail = await getEmailByUserId(profile?.id);
        await sendEmail({
          to: userEmail,
          subject: "You're in. Payment confirmed. 🔥",
          html: `
<h2>Payment confirmed. You're all in.</h2>
<p>Your subscription is active and ready.</p>
<p>You now have full access to nightly reflection, accountability tracking, and insight history.</p>
<p>
  <a href="https://retaliateai.com/reflection" style="display:inline-block;padding:12px 24px;background-color:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
    Open Retaliate AI
  </a>
</p>
<p style="color:#94a3b8;font-size:12px;">Built for people who are done making excuses.</p>
`,
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
        if (invoice.billing_reason === 'subscription_cycle') {
          const profile = await getProfileByCustomer(invoice.customer);
          const userEmail = await getEmailByUserId(profile?.id);
          const paidAt = asIsoTimestamp(invoice.status_transitions?.paid_at || invoice.created);
          const nextBillingAt = asIsoTimestamp(periodEnd);
          await sendEmail({
            to: userEmail,
            subject: 'Billing confirmed — another month of showing up.',
            html: `
<h2>Billing confirmed.</h2>
<p>Amount charged: <strong>${formatCurrency(invoice.amount_paid, invoice.currency)}</strong></p>
<p>Billing date: <strong>${formatDate(paidAt)}</strong></p>
<p>Next billing date: <strong>${formatDate(nextBillingAt)}</strong></p>
<p>
  <a href="https://retaliateai.com/settings" style="display:inline-block;padding:12px 24px;background-color:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
    Open Billing History
  </a>
</p>
<p style="color:#94a3b8;font-size:12px;">Built for people who are done making excuses.</p>
`,
          });
        }
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
