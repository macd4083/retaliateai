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

async function sendPushToUser(userId, notifTitle, notifBody) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId);

  if (!subs?.length) return 0;

  const payload = JSON.stringify({
    title: notifTitle,
    body: notifBody,
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
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        const { data: lastSession } = await supabase
          .from('reflection_sessions')
          .select('tomorrow_commitment, commitment_minimum, is_complete, date, reflection_streak')
          .eq('user_id', profile.id)
          .eq('date', yesterdayStr)
          .maybeSingle();

        const todayStr = new Date().toISOString().slice(0, 10);
        const { data: todaySession } = await supabase
          .from('reflection_sessions')
          .select('is_complete')
          .eq('user_id', profile.id)
          .eq('date', todayStr)
          .maybeSingle();

        const alreadyDoneToday = todaySession?.is_complete === true;
        if (alreadyDoneToday) continue;

        const streak = lastSession?.reflection_streak || 0;
        let notifTitle = 'Retaliate AI';
        let notifBody = "Time for your nightly reflection. 🌙";

        if (lastSession?.tomorrow_commitment) {
          const commitment = lastSession.commitment_minimum || lastSession.tomorrow_commitment;
          const shortCommitment = commitment.length > 65
            ? commitment.slice(0, 62) + '...'
            : commitment;
          notifBody = `You said you'd: "${shortCommitment}" — did you?`;
        } else if (streak >= 3) {
          notifBody = `${streak}-night streak. Don't break it tonight. 🔥`;
        }

        const sent = await sendPushToUser(profile.id, notifTitle, notifBody);
        totalSent += sent;
      }
    } catch (err) {
      console.error(`nightly-push: error processing user ${profile.id}`, err);
    }
  }

  return res.status(200).json({ sent: totalSent, checked: profiles?.length ?? 0 });
}
