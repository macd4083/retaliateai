import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'delivered@resend.dev';
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function sanitizeSubject(text = '') {
  return String(text).replace(/[\r\n]+/g, ' ').trim();
}

function trialEndingSoonHtml() {
  return `
<h2>2 days left.</h2>
<p>Your Retaliate AI trial is about to end.</p>
<p>Keep momentum by checking in tonight. If you need more time, you'll see an option in-app to give feedback and unlock one more free week.</p>
<p>
  <a href="https://retaliateai.com/reflection" style="display:inline-block;padding:12px 24px;background-color:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
    Open Reflection
  </a>
</p>
<p><a href="https://retaliateai.com/settings">Upgrade in Settings</a></p>
<p style="color:#94a3b8;font-size:12px;">Built for people who are done making excuses.</p>
`;
}

function trialExpiredFeedbackOfferHtml() {
  return `
<h2>Your trial ended.</h2>
<p>You can still get one more free week.</p>
<p>Open the app, submit quick feedback, and your trial gets extended by 7 days.</p>
<p>
  <a href="https://retaliateai.com/reflection" style="display:inline-block;padding:12px 24px;background-color:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
    Open App &amp; Submit Feedback
  </a>
</p>
<p style="color:#94a3b8;font-size:12px;">Built for people who are done making excuses.</p>
`;
}

function extendedTrialExpiredHtml() {
  return `
<h2>Your extended trial is up.</h2>
<p>You already got the extra week. If this is helping, lock it in with a paid plan.</p>
<p>
  <a href="https://retaliateai.com/settings" style="display:inline-block;padding:12px 24px;background-color:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
    Upgrade Now
  </a>
</p>
<p style="color:#94a3b8;font-size:12px;">Built for people who are done making excuses.</p>
`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const now = new Date();
  const twoDaysFromNow = new Date(now.getTime() + TWO_DAYS_MS);
  const emailsSent = [];

  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, trial_ends_at, feedback_submitted, trial_extended, last_trial_email_sent_at')
    .eq('subscription_status', 'trialing')
    .not('trial_ends_at', 'is', null);

  if (profileError) {
    return res.status(500).json({ error: profileError.message });
  }

  for (const profile of profiles || []) {
    try {
      if (profile.last_trial_email_sent_at) {
        const lastSent = new Date(profile.last_trial_email_sent_at);
        const lastSentAt = lastSent.getTime();
        if (!Number.isNaN(lastSentAt) && now.getTime() - lastSentAt < TWO_DAYS_MS) {
          continue;
        }
      }

      const trialEndsAt = new Date(profile.trial_ends_at);
      if (Number.isNaN(trialEndsAt.getTime())) continue;

      let subject = '';
      let html = '';
      let emailType = '';

      if (trialEndsAt > now && trialEndsAt <= twoDaysFromNow) {
        subject = '2 days left on your Retaliate AI trial';
        html = trialEndingSoonHtml();
        emailType = 'ending_soon';
      } else if (trialEndsAt < now && !profile.feedback_submitted) {
        subject = "Your trial ended — here's how to get one more week free";
        html = trialExpiredFeedbackOfferHtml();
        emailType = 'trial_expired_feedback_offer';
      } else if (trialEndsAt < now && profile.feedback_submitted && profile.trial_extended) {
        subject = 'Your extended trial is up — time to decide';
        html = extendedTrialExpiredHtml();
        emailType = 'extended_trial_expired';
      }

      if (!subject || !html) continue;

      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(profile.id);
      if (authError || !authUser?.user?.email) continue;

      const { error: sendError } = await resend.emails.send({
        from: FROM_EMAIL,
        to: authUser.user.email,
        subject: sanitizeSubject(subject),
        html,
      });

      if (sendError) continue;

      await supabase
        .from('user_profiles')
        .update({ last_trial_email_sent_at: now.toISOString() })
        .eq('id', profile.id);

      emailsSent.push({ user_id: profile.id, type: emailType });
    } catch (_error) {
      // continue processing others
    }
  }

  return res.status(200).json({ sent: emailsSent.length, emails: emailsSent });
}
