import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'delivered@resend.dev';

const EMAIL_HTML = `
<h2>Don't miss twice.</h2>

<p>You've been building something. Missing one day happens. Missing two starts a pattern.</p>

<p>Your reflection is waiting. It takes five minutes.</p>

<p>
  <a href="https://retaliateai.vercel.app/reflection" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
    Pick up where you left off
  </a>
</p>

<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />

<p style="color: #94a3b8; font-size: 12px;">
  Retaliate AI - AI-Powered Journaling for Results<br/>
  © 2026 Retaliate AI. All rights reserved.
</p>
`;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = twoDaysAgo.toISOString().slice(0, 10);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  // Get users who have completed onboarding
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, last_reengagement_email_sent')
    .eq('onboarding_completed', true);

  if (profileError) {
    console.error('missed-sessions-email: error fetching profiles', profileError);
    return res.status(500).json({ error: profileError.message });
  }

  const emailsSent = [];

  for (const profile of profiles || []) {
    try {
      // Skip users who received a re-engagement email in the last 7 days
      if (profile.last_reengagement_email_sent) {
        const lastSent = new Date(profile.last_reengagement_email_sent);
        const daysSince = (now - lastSent) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) continue;
      }

      // Check for sessions yesterday and the day before (must have NONE)
      const { data: recentSessions } = await supabase
        .from('reflection_sessions')
        .select('date')
        .eq('user_id', profile.id)
        .in('date', [yesterdayStr, twoDaysAgoStr]);

      if (recentSessions?.length > 0) continue; // They have sessions — not lapsed

      // Must have at least one session older than 2 days ago (so they've actually used the app)
      const { data: olderSessions } = await supabase
        .from('reflection_sessions')
        .select('date')
        .eq('user_id', profile.id)
        .lt('date', twoDaysAgoStr)
        .limit(1);

      if (!olderSessions?.length) continue; // Brand new user, no prior history

      // Get user email from auth
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(profile.id);
      if (authError || !authUser?.user?.email) continue;

      const userEmail = authUser.user.email;

      // Send re-engagement email
      const { error: sendError } = await resend.emails.send({
        from: FROM_EMAIL,
        to: userEmail,
        subject: "Don't miss twice.",
        html: EMAIL_HTML,
      });

      if (sendError) {
        console.error(`missed-sessions-email: send error for ${profile.id}`, sendError);
        continue;
      }

      // Update last_reengagement_email_sent
      await supabase
        .from('user_profiles')
        .update({ last_reengagement_email_sent: now.toISOString() })
        .eq('id', profile.id);

      emailsSent.push(profile.id);
    } catch (err) {
      console.error(`missed-sessions-email: error processing user ${profile.id}`, err);
    }
  }

  return res.status(200).json({ sent: emailsSent.length, users: emailsSent });
}
