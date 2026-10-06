import React from 'react';
import { supabase } from '../../lib/supabase/client';
import { getScheduleDateBounds } from '../today/scheduling';

const memoryCache = new Map();
let cacheOwner = null;
const buttonClass = 'rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:border-zinc-500 disabled:opacity-50';

async function calendarRequest(action, body, params = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.access_token) throw new Error('Please sign in again to connect your calendar.');
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api/google-calendar?${query}`, {
    credentials: 'same-origin',
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: ['Bearer', data.session.access_token].join(' '), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || 'Google Calendar is temporarily unavailable.');
    error.reconnect = payload.code === 'reconnect_required';
    throw error;
  }
  return payload;
}

export default function GoogleCalendarConnection({ userId, localDate, timezone = 'UTC', onEvents, settings = false }) {
  const callbackResult = new URLSearchParams(window.location.search).get('googleCalendar');
  const [status, setStatus] = React.useState(null);
  const [calendars, setCalendars] = React.useState([]);
  const [selected, setSelected] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [stale, setStale] = React.useState(false);
  const [reconnect, setReconnect] = React.useState(false);
  const lastRefresh = React.useRef(0);
  const refreshGeneration = React.useRef(0);
  const eventsCallback = React.useRef(onEvents);
  eventsCallback.current = onEvents;
  const cacheKey = `${userId}:${localDate}:${timezone}`;

  const refresh = React.useCallback(async () => {
    if (!userId) return;
    const generation = ++refreshGeneration.current;
    setBusy(true);
    setError('');
    lastRefresh.current = Date.now();
    try {
      const nextStatus = await calendarRequest('status');
      if (generation !== refreshGeneration.current) return;
      setStatus(nextStatus);
      setReconnect(false);
      if (nextStatus.message) setError(nextStatus.message);
      if (nextStatus.connected) {
        const list = await calendarRequest('calendars');
        if (generation !== refreshGeneration.current) return;
        setCalendars(list.calendars || []);
        setSelected(list.selectedCalendarIds || nextStatus.selectedCalendarIds || []);
        if (localDate && !settings) {
          const bounds = getScheduleDateBounds(localDate, timezone);
          const result = await calendarRequest('events', undefined, { timeMin: bounds.starts_at, timeMax: bounds.ends_at });
          if (generation !== refreshGeneration.current) return;
          const events = result.events || [];
          memoryCache.set(cacheKey, events);
          if (memoryCache.size > 14) memoryCache.delete(memoryCache.keys().next().value);
          eventsCallback.current?.(events);
        }
      } else {
        memoryCache.delete(cacheKey);
        eventsCallback.current?.([]);
      }
      setStale(false);
    } catch (failure) {
      if (generation !== refreshGeneration.current) return;
      setError(failure.message);
      setReconnect(Boolean(failure.reconnect));
      setStale(memoryCache.has(cacheKey));
    } finally {
      if (generation === refreshGeneration.current) setBusy(false);
    }
  }, [userId, localDate, timezone, settings, cacheKey]);

  React.useEffect(() => {
    if (cacheOwner !== userId) {
      memoryCache.clear();
      cacheOwner = userId;
    }
    setStatus(null);
    setStale(false);
    eventsCallback.current?.(memoryCache.get(cacheKey) || []);
    void refresh();
    const resume = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 60_000) void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      refreshGeneration.current += 1;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [refresh, cacheKey]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await calendarRequest('connect', { returnPath: window.location.pathname });
      const destination = new URL(result.authorizationUrl, window.location.origin);
      if (destination.protocol !== 'https:' || destination.hostname !== 'accounts.google.com') throw new Error('Invalid Google connection link.');
      window.location.assign(destination.href);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  const saveSelection = async () => {
    setBusy(true);
    try {
      await calendarRequest('select', { calendarIds: selected });
      await refresh();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await calendarRequest('disconnect', {});
      for (const key of memoryCache.keys()) if (key.startsWith(`${userId}:`)) memoryCache.delete(key);
      setStatus({ connected: false });
      setCalendars([]);
      setSelected([]);
      setStale(false);
      eventsCallback.current?.([]);
      setError('');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Google Calendar</h3>
          <p className="mt-1 text-xs text-zinc-400">{status?.connected ? 'Connected · read-only availability' : 'See your availability alongside your plan.'}</p>
        </div>
        <div className="flex gap-2">
          {(!status?.connected || reconnect) && <button type="button" className={buttonClass} disabled={busy || status?.configured === false || status?.schemaAvailable === false} onClick={connect}>{reconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</button>}
          {status?.connected && <button type="button" className={buttonClass} disabled={busy} onClick={refresh}>Refresh</button>}
          {settings && status?.connected && <button type="button" className={buttonClass} disabled={busy} onClick={disconnect}>Disconnect</button>}
        </div>
      </div>
      <p className="text-xs text-zinc-500">Your local plan stays in Retaliate. Connecting or disconnecting does not change it.</p>
      {status?.connected && calendars.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-300">Choose calendars ({selected.length})</summary>
          <fieldset className="mt-2 space-y-2">
            <legend className="sr-only">Calendars to display</legend>
            {calendars.map((calendar) => (
              <label key={calendar.id} className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={selected.includes(calendar.id)} disabled={busy || (selected.length >= 10 && !selected.includes(calendar.id))} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, calendar.id] : previous.filter((id) => id !== calendar.id))} />
                {calendar.summary || calendar.name || calendar.id}
              </label>
            ))}
            <p className="text-xs text-zinc-500">Select up to 10 calendars.</p>
            <button type="button" className={buttonClass} disabled={busy} onClick={saveSelection}>Apply calendars</button>
          </fieldset>
        </details>
      )}
      <div aria-live="polite" className="text-xs text-zinc-400">
        {callbackResult === 'denied' && <p className="text-amber-300">Google connection was canceled. Your local plan is unchanged.</p>}
        {busy && <p>Updating calendar…</p>}
        {error && <p className="text-amber-300">{error} Your review is still available.</p>}
        {stale && <p className="text-amber-300">Showing cached calendar events — they may be out of date.</p>}
      </div>
    </div>
  );
}
