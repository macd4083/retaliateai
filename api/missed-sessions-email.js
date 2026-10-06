import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { escapeHtml, getLocalReviewContext, isAuthorizedCron, publicAppUrl } from '../server/notifications.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'delivered@resend.dev';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function buildEmailHtml() {
  return `
<h2>Your daily review is here when you're ready.</h2>
<p>Review today and prepare tomorrow. Start with your habits, review your commitments, and make a plan for tomorrow.</p>
<p><a href="${escapeHtml(publicAppUrl('/today'))}" style="display:inline-block;padding:12px 24px;background-color:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Open Today</a></p>
<p style="color:#94a3b8;font-size:12px;">Retaliate AI</p>
`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'Unauthorized' });

  const now = new Date();
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, timezone, last_reengagement_email_sent')
    .eq('onboarding_completed', true);
  if (profileError) {
    return res.status(500).json({ error: 'Unable to load reminder profiles' });
  }

  const emailsSent = [];
  for (const profile of profiles || []) {
    try {
      if (profile.last_reengagement_email_sent) {
        const lastSent = new Date(profile.last_reengagement_email_sent).getTime();
        if (!Number.isFinite(lastSent) || now.getTime() - lastSent < SEVEN_DAYS_MS) continue;
      }
      const context = getLocalReviewContext(now, profile.timezone);
      if (!context) continue;

      const { data: recentReviews, error: recentError } = await supabase
        .from('today_v2_daily_reviews')
        .select('local_date, completed_at')
        .eq('user_id', profile.id)
        .in('local_date', [...context.missedDates, context.reviewDate])
        .not('completed_at', 'is', null);
      // Never treat a failed query as inactivity; today's completion also suppresses reminders.
      if (recentError || !recentReviews || recentReviews.length) continue;

      const { data: olderReviews, error: olderError } = await supabase
        .from('today_v2_daily_reviews')
        .select('local_date, completed_at')
        .eq('user_id', profile.id)
        .lt('local_date', context.missedDates[1])
        .not('completed_at', 'is', null)
        .limit(1);
      if (olderError || !olderReviews?.length) continue;

      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(profile.id);
      if (authError || !authUser?.user?.email) continue;
      const { error: sendError } = await resend.emails.send({
        from: FROM_EMAIL,
        to: authUser.user.email,
        subject: 'Review today and prepare tomorrow',
        html: buildEmailHtml(),
      });
      if (sendError) continue;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ last_reengagement_email_sent: now.toISOString() })
        .eq('id', profile.id);
      if (updateError) console.error('missed-sessions-email: cooldown update failed', profile.id);
      emailsSent.push(profile.id);
    } catch {
      console.error('missed-sessions-email: unable to process reminder', profile.id);
    }
  }
  return res.status(200).json({ sent: emailsSent.length, users: emailsSent });
}
