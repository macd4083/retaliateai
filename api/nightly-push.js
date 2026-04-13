import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

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
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId);

  if (!subs?.length) return 0;

  const payload = JSON.stringify({
    title: 'Time to reflect.',
    body: 'Your streak is waiting. What happened today?',
    url: '/reflection',
  });

  let sent = 0;
  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — remove it
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

  // Fetch users who have completed onboarding and have a preferred_reflection_time set
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('id, preferred_reflection_time, timezone')
    .eq('onboarding_completed', true)
    .not('preferred_reflection_time', 'is', null)
    .not('timezone', 'is', null);

  if (error) {
    console.error('nightly-push: error fetching profiles', error);
    return res.status(500).json({ error: error.message });
  }

  const now = new Date();

  let totalSent = 0;

  for (const profile of profiles || []) {
    try {
      // Get the current time in the user's timezone
      const userNow = new Date(
        now.toLocaleString('en-US', { timeZone: profile.timezone })
      );
      const userHour = userNow.getHours();
      const userMinute = userNow.getMinutes();

      // Parse preferred_reflection_time (format: "HH:MM")
      const [prefHour, prefMinute] = profile.preferred_reflection_time.split(':').map(Number);

      if (userHour === prefHour && userMinute === prefMinute) {
        const sent = await sendPushToUser(profile.id);
        totalSent += sent;
      }
    } catch (err) {
      console.error(`nightly-push: error processing user ${profile.id}`, err);
    }
  }

  return res.status(200).json({ sent: totalSent, checked: profiles?.length ?? 0 });
}
