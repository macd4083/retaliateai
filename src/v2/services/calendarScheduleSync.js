import { supabase } from '../../lib/supabase/client';

export const SCHEDULE_SYNC_EVENT = 'retaliate-schedule-calendar-sync';
const queues = new Map();
const failures = new Map();
export const getScheduleSyncFailure = (userId, date) => failures.get(`${userId}:${date}`) || null;

export async function syncSavedSchedule({ userId, targetLocalDate }) {
  if (!userId) return;
  const key = `${userId}:${targetLocalDate}`;
  const run = async () => {
    let current = true;
    const controller = new AbortController();
    const subscription = supabase.auth.onAuthStateChange?.((event, session) => {
      if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== userId)) {
        current = false;
        controller.abort();
        failures.delete(key);
      }
    });
    const publish = (error, synced = false) => {
      if (!current) return;
      if (error) failures.set(key, error); else failures.delete(key);
      window.dispatchEvent(new CustomEvent(SCHEDULE_SYNC_EVENT, {
        detail: { userId, targetLocalDate, error, synced },
      }));
    };
    try {
      const { data } = await supabase.auth.getSession();
      if (!current || data?.session?.user?.id !== userId) return;
      if (!data.session.access_token) throw new Error('Sign in again to sync your Google Calendar.');
      publish(null);
      const response = await fetch('/api/google-calendar?action=sync', {
        method: 'POST', credentials: 'same-origin',
        headers: { Authorization: ['Bearer', data.session.access_token].join(' '), 'Content-Type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        body: JSON.stringify({ targetLocalDate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Google Calendar is unavailable.');
      const latest = await supabase.auth.getSession();
      if (!current || latest.data?.session?.user?.id !== userId) return;
      if (payload.connected !== false && payload.synced !== true) throw new Error('Google Calendar did not confirm synchronization.');
      publish(null, payload.synced === true);
    } catch (error) {
      publish(`Saved locally, but Google Calendar sync failed: ${error.message} Retry sync; your local plan is safe.`);
    } finally {
      subscription?.data?.subscription?.unsubscribe();
    }
  };
  const pending = (queues.get(key) || Promise.resolve()).then(run);
  queues.set(key, pending);
  await pending;
  if (queues.get(key) === pending) queues.delete(key);
}
