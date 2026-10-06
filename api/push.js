import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import {
  getLocalReviewContext,
  isAuthorizedCron,
  REVIEW_REMINDER_BODY,
  REVIEW_REMINDER_TITLE,
} from '../server/notifications.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushToUser(userId) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId);

  if (error || !subs?.length) return 0;

  const payload = JSON.stringify({
    title: REVIEW_REMINDER_TITLE,
    body: REVIEW_REMINDER_BODY,
    url: '/today',
  });
  let sent = 0;

  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('subscription', row.subscription);
      }
    }
  }

  return sent;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { user_id } = req.body || {};

  // Direct-send mode
  if (user_id) {
    const sent = await sendPushToUser(user_id);
    return res.status(200).json({ sent });
  }

  // Nightly broadcast mode
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('id, preferred_reflection_time, timezone')
    .eq('onboarding_completed', true)
    .not('preferred_reflection_time', 'is', null)
    .not('timezone', 'is', null);

  if (error) {
    console.error('push: error fetching profiles', error);
    return res.status(500).json({ error: error.message });
  }

  const now = new Date();
  let totalSent = 0;

  for (const profile of profiles || []) {
    try {
      const context = getLocalReviewContext(now, profile.timezone);
      if (!context) continue;
      const [prefHour, prefMinute] = profile.preferred_reflection_time.split(':').map(Number);

      if (context.hour === prefHour && context.minute === prefMinute) {
        const { data: todayReview, error: reviewError } = await supabase
          .from('today_v2_daily_reviews')
          .select('completed_at')
          .eq('user_id', profile.id)
          .eq('local_date', context.reviewDate)
          .maybeSingle();

        if (reviewError || todayReview?.completed_at) continue;
        const sent = await sendPushToUser(profile.id);
        totalSent += sent;
      }
    } catch (err) {
      console.error(`push: error processing user ${profile.id}`, err);
    }
  }

  return res.status(200).json({ sent: totalSent, checked: profiles?.length ?? 0 });
}
