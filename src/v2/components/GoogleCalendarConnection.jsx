import React from 'react';
import { supabase } from '../../lib/supabase/client';
import { getScheduleDateBounds } from '../today/scheduling';
import GoogleCalendarEventEditor from './GoogleCalendarEventEditor';

const memoryCache = new Map();
let cacheOwner = null;
let cacheGeneration = 0;
const savedSelections = new Map();
const cacheVersions = new Map();
const CACHE_EVENT = 'retaliate-google-calendar-change';
const buttonClass = 'rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:border-zinc-500 disabled:opacity-50';

function invalidateCalendarCache(userId, reason) {
  cacheVersions.set(userId, (cacheVersions.get(userId) || 0) + 1);
  for (const key of memoryCache.keys()) if (key.startsWith(`${userId}:`)) memoryCache.delete(key);
  if (reason) window.dispatchEvent(new CustomEvent(CACHE_EVENT, { detail: { userId, reason } }));
}

async function calendarRequest(action, body, params = {}, userId, isAuthorized) {
  const { data } = await supabase.auth.getSession();
  if (!isAuthorized() || !data?.session?.access_token || (data.session.user?.id && data.session.user.id !== userId)) {
    const error = /** @type {Error & { signedOut?: boolean }} */ (new Error('Please sign in again to connect your calendar.'));
    error.signedOut = true;
    throw error;
  }
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
    error.disconnected = payload.code === 'not_connected';
    error.upgrade = payload.code === 'permission_upgrade_required';
    throw error;
  }
  return payload;
}

export default function GoogleCalendarConnection({ userId, localDate = null, timezone = 'UTC', onEvents = null, onControls = null, onWritePending = null, readOnly = false, completionSaving = false, settings = false, includeNextDay = false }) {
  const callbackResult = new URLSearchParams(window.location.search).get('googleCalendar');
  const [status, setStatus] = React.useState(null);
  const [calendars, setCalendars] = React.useState([]);
  const [selected, setSelected] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const setCalendarBusy = React.useCallback((value) => {
    busyRef.current = value;
    setBusy(value);
  }, []);
  const [error, setError] = React.useState('');
  const [stale, setStale] = React.useState(false);
  const [reconnect, setReconnect] = React.useState(false);
  const [warning, setWarning] = React.useState('');
  const [visibleEvents, setVisibleEvents] = React.useState([]);
  const [editor, setEditor] = React.useState(null);
  const [writing, setWriting] = React.useState(false);
  const pendingWrite = React.useRef(null);
  const pendingCallback = React.useRef(onWritePending);
  pendingCallback.current = onWritePending;
  const setCalendarWriting = React.useCallback((value) => {
    setWriting(value);
    pendingCallback.current?.(value);
  }, []);
  const authIdentity = React.useRef({ userId, allowed: true, generation: 0 });
  if (authIdentity.current.userId !== userId) authIdentity.current = { userId, allowed: true, generation: authIdentity.current.generation + 1 };
  const controlsImplementation = React.useRef(null);
  const controls = React.useMemo(() => ({
    edit: (event) => controlsImplementation.current?.edit(event),
    update: (event, times) => controlsImplementation.current?.update(event, times),
  }), []);
  const lastRefresh = React.useRef(0);
  const refreshGeneration = React.useRef(0);
  const eventsCallback = React.useRef(onEvents);
  eventsCallback.current = onEvents;
  const cacheKey = `${userId}:${localDate}:${timezone}:${includeNextDay}`;
  const context = React.useRef(cacheKey);
  context.current = cacheKey;
  const request = React.useCallback((action, body, params) => {
    const generation = authIdentity.current.generation;
    return calendarRequest(action, body, params, userId, () => authIdentity.current.allowed && authIdentity.current.userId === userId && authIdentity.current.generation === generation);
  }, [userId]);
  const clearFailedAuthorization = React.useCallback((failure) => {
    if (failure.upgrade) {
      setStatus((previous) => ({ ...previous, canWrite: false, needsUpgrade: true }));
      setEditor(null);
      setError(failure.message);
      return true;
    }
    if (!failure.signedOut && !failure.reconnect && !failure.disconnected) return false;
    invalidateCalendarCache(userId, failure.reconnect ? 'reconnect' : 'disconnect');
    setError(failure.message);
    return true;
  }, [userId]);

  const refresh = React.useCallback(async () => {
    if (!userId) return;
    const generation = ++refreshGeneration.current;
    const cacheVersion = cacheGeneration;
    const userVersion = cacheVersions.get(userId) || 0;
    const isCurrent = () => generation === refreshGeneration.current && cacheVersion === cacheGeneration &&
      userVersion === (cacheVersions.get(userId) || 0) && context.current === cacheKey;
    setCalendarBusy(true);
    setError('');
    setWarning(memoryCache.get(cacheKey)?.warning || '');
    setStale(memoryCache.has(cacheKey));
    lastRefresh.current = Date.now();
    try {
      const nextStatus = await request('status');
      if (!isCurrent()) return;
      setStatus(nextStatus);
      if (!nextStatus.connected || !nextStatus.canWrite || nextStatus.configured === false || nextStatus.schemaAvailable === false) setEditor(null);
      setReconnect(false);
      if (nextStatus.message) setError(nextStatus.message);
      if (nextStatus.connected && nextStatus.configured !== false && nextStatus.schemaAvailable !== false) {
        let availabilityWarning = '';
        const persisted = nextStatus.selectedCalendarIds || [];
        const fingerprint = JSON.stringify([...persisted].sort());
        if (savedSelections.has(userId) && savedSelections.get(userId) !== fingerprint) {
          for (const key of memoryCache.keys()) if (key.startsWith(`${userId}:`)) memoryCache.delete(key);
          eventsCallback.current?.([]);
          setVisibleEvents([]);
          setStale(false);
        }
        savedSelections.set(userId, fingerprint);
        setSelected(persisted);
        try {
          const list = await request('calendars');
          if (!isCurrent()) return;
          setCalendars(list.calendars || []);
          setSelected(list.selectedCalendarIds || persisted);
          const missing = persisted.filter((id) => !(list.calendars || []).some((calendar) => calendar.id === id));
          if (missing.length) availabilityWarning = `${missing.length} selected calendar(s) are missing from the available list. Availability may be incomplete.`;
        } catch (failure) {
          if (!isCurrent()) return;
          if (failure.reconnect || failure.signedOut || failure.disconnected) throw failure;
          setCalendars([]);
          availabilityWarning = 'Calendar choices could not be loaded. Saved selections are unchanged; retry to manage them.';
        }
        setWarning(availabilityWarning || memoryCache.get(cacheKey)?.warning || '');
        if (localDate && !settings) {
          const bounds = getScheduleDateBounds(localDate, timezone);
          const timeMax = includeNextDay ? new Date(Date.parse(bounds.ends_at) + 24 * 60 * 60 * 1000).toISOString() : bounds.ends_at;
          const result = await request('events', undefined, { timeMin: bounds.starts_at, timeMax });
          if (!isCurrent()) return;
          const events = result.events || [];
          if (result.partial) availabilityWarning = `${result.unavailableCalendars?.length || 1} selected calendar(s) could not be loaded. Showing partial availability — do not assume the remaining time is free.`;
          memoryCache.set(cacheKey, { events, warning: availabilityWarning });
          if (memoryCache.size > 14) memoryCache.delete(memoryCache.keys().next().value);
          eventsCallback.current?.(events);
          setVisibleEvents(events);
          setWarning(availabilityWarning);
        }
      } else {
        invalidateCalendarCache(userId);
        setCalendars([]);
        setSelected([]);
        setWarning(memoryCache.get(cacheKey)?.warning || '');
        eventsCallback.current?.([]);
        setVisibleEvents([]);
      }
      setStale(false);
    } catch (failure) {
      if (!isCurrent()) return;
      if (clearFailedAuthorization(failure)) return;
      setError(failure.message);
      setReconnect(Boolean(failure.reconnect));
      setStale(memoryCache.has(cacheKey));
      if (memoryCache.has(cacheKey)) setWarning(memoryCache.get(cacheKey).warning || '');
    } finally {
      if (generation === refreshGeneration.current) setCalendarBusy(false);
    }
  }, [userId, localDate, timezone, settings, includeNextDay, cacheKey, request, clearFailedAuthorization]);

  React.useEffect(() => {
    if (cacheOwner !== userId) {
      memoryCache.clear();
      savedSelections.clear();
      cacheOwner = userId;
      cacheGeneration += 1;
    }
    setStatus(null);
    setCalendars([]);
    setSelected([]);
    setError('');
    setWarning('');
    setReconnect(false);
    setCalendarBusy(false);
    pendingWrite.current = null;
    setCalendarWriting(false);
    setEditor(null);
    setStale(memoryCache.has(cacheKey));
    eventsCallback.current?.(memoryCache.get(cacheKey)?.events || []);
    setVisibleEvents(memoryCache.get(cacheKey)?.events || []);
    void refresh();
    const resume = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 60_000) void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    const changed = (event) => {
      const { detail } = /** @type {CustomEvent<{ userId: string, reason: string }>} */ (event);
      if (detail.userId !== userId) return;
      refreshGeneration.current += 1;
      eventsCallback.current?.([]);
      setVisibleEvents([]);
      setStale(false);
      setWarning('');
      setCalendarBusy(false);
      if (detail.reason === 'disconnect' || detail.reason === 'reconnect') {
        setStatus((previous) => ({ ...previous, connected: false, selectedCalendarIds: [] }));
        setCalendars([]);
        setSelected([]);
        setReconnect(detail.reason === 'reconnect');
        setEditor(null);
        pendingWrite.current = null;
        setCalendarWriting(false);
        setError(detail.reason === 'reconnect' ? 'Google Calendar authorization expired or was revoked. Reconnect your calendar.' : '');
      } else void refresh();
    };
    window.addEventListener(CACHE_EVENT, changed);
    const subscription = supabase.auth.onAuthStateChange?.((event, session) => {
      if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== userId)) {
        authIdentity.current.allowed = false;
        authIdentity.current.generation += 1;
        savedSelections.delete(userId);
        invalidateCalendarCache(userId, 'disconnect');
      } else if (session?.user?.id === userId && !authIdentity.current.allowed) {
        authIdentity.current.allowed = true;
        authIdentity.current.generation += 1;
        void refresh();
      }
    });
    return () => {
      refreshGeneration.current += 1;
      pendingWrite.current = null;
      pendingCallback.current?.(false);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener(CACHE_EVENT, changed);
      subscription?.data?.subscription?.unsubscribe();
    };
  }, [refresh, cacheKey]);

  React.useEffect(() => {
    onControls?.(controls);
    return () => onControls?.(null);
  }, [onControls, controls]);

  const locked = readOnly || completionSaving || writing || busy;
  const writableCalendars = calendars.filter((calendar) => ['owner', 'writer'].includes(calendar.accessRole));
  const canManage = status?.connected && status?.canWrite && status.configured !== false && status.schemaAvailable !== false;
  const canEdit = (event) => canManage && event?.editable && event.eventId && event.calendarId;
  const mutate = async (action, event, body) => {
    if (locked || busyRef.current || pendingWrite.current || !authIdentity.current.allowed) throw new Error('Google event changes are currently locked.');
    if (!canManage || (action !== 'create' && !canEdit(event))) throw new Error('This Google event is read-only. Reconnect to enable event management if needed.');
    if (action === 'create' && !writableCalendars.some((calendar) => calendar.id === body.calendarId)) throw new Error('Choose a writable destination calendar.');
    const token = { key: cacheKey, authGeneration: authIdentity.current.generation };
    pendingWrite.current = token;
    const isCurrent = () => pendingWrite.current === token && context.current === token.key;
    setCalendarWriting(true);
    setError('');
    try {
      const result = await request(action, action === 'create' ? body : {
        calendarId: event.calendarId, eventId: event.eventId, etag: event.etag,
        ...(action === 'update' ? { event: body.event } : {}),
      });
      invalidateCalendarCache(userId, authIdentity.current.allowed && authIdentity.current.generation === token.authGeneration && context.current.startsWith(`${userId}:`) ? 'mutation' : undefined);
      if (isCurrent()) setEditor(null);
      return result;
    } catch (failure) {
      if (isCurrent()) {
        if (!clearFailedAuthorization(failure)) setError(failure.message);
      }
      throw failure;
    } finally {
      if (isCurrent()) {
        pendingWrite.current = null;
        setCalendarWriting(false);
      }
    }
  };
  controlsImplementation.current = {
    edit: (event) => {
      if (!locked && !busyRef.current && !pendingWrite.current && authIdentity.current.allowed && canEdit(event)) setEditor({ event });
    },
    update: async (event, { starts_at, ends_at }) => {
      if (event?.allDay) throw new Error('Edit all-day events using date fields.');
      if (!Number.isFinite(Date.parse(starts_at)) || !Number.isFinite(Date.parse(ends_at)) || Date.parse(ends_at) <= Date.parse(starts_at)) throw new Error('End time must be after start time.');
      const timeZone = event?.timeZone || timezone;
      return mutate('update', event, { event: {
        start: { dateTime: new Date(starts_at).toISOString(), timeZone },
        end: { dateTime: new Date(ends_at).toISOString(), timeZone },
      } });
    },
  };

  const connect = async () => {
    if (locked || busyRef.current || pendingWrite.current || !authIdentity.current.allowed) return;
    const generation = ++refreshGeneration.current;
    const isCurrent = () => generation === refreshGeneration.current && context.current === cacheKey;
    setCalendarBusy(true);
    setError('');
    try {
      const result = await request('connect', { returnPath: settings ? '/settings' : '/today' });
      if (!isCurrent()) return;
      const destination = new URL(result.authorizationUrl, window.location.origin);
      if (destination.origin !== 'https://accounts.google.com' || destination.pathname !== '/o/oauth2/v2/auth' || destination.username || destination.password || destination.hash) throw new Error('Invalid Google connection link.');
      window.location.assign(destination.href);
    } catch (failure) {
      if (!isCurrent()) return;
      if (clearFailedAuthorization(failure)) return;
      setError(failure.message);
    } finally {
      if (isCurrent()) setCalendarBusy(false);
    }
  };

  const saveSelection = async () => {
    if (locked || busyRef.current || pendingWrite.current || !authIdentity.current.allowed) return;
    const generation = ++refreshGeneration.current;
    const isCurrent = () => generation === refreshGeneration.current && context.current === cacheKey;
    setCalendarBusy(true);
    setError('');
    try {
      await request('select', { calendarIds: selected });
      if (!isCurrent()) return;
      savedSelections.set(userId, JSON.stringify([...selected].sort()));
      invalidateCalendarCache(userId, 'selection');
    } catch (failure) {
      if (!isCurrent()) return;
      if (clearFailedAuthorization(failure)) return;
      setError(failure.message);
    } finally {
      if (isCurrent()) setCalendarBusy(false);
    }
  };

  const disconnect = async () => {
    if (locked || busyRef.current || pendingWrite.current || !authIdentity.current.allowed) return;
    const generation = ++refreshGeneration.current;
    const isCurrent = () => generation === refreshGeneration.current && context.current === cacheKey;
    setCalendarBusy(true);
    try {
      await request('disconnect', {});
      if (!isCurrent()) return;
      invalidateCalendarCache(userId, 'disconnect');
    } catch (failure) {
      if (!isCurrent()) return;
      if (clearFailedAuthorization(failure)) return;
      setError(failure.message);
    } finally {
      if (isCurrent()) setCalendarBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Google Calendar</h3>
          <p className="mt-1 text-xs text-zinc-400">{status?.connected ? status.configured === false || status.schemaAvailable === false ? 'Connected · availability currently unavailable' : canManage ? 'Connected · Google event management' : 'Connected · read-only availability' : 'Optional import — no Google sign-in needed to use your planner.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(!status?.connected || reconnect || status?.needsUpgrade) && <button type="button" className={buttonClass} disabled={!userId || !status || busy || locked || status?.configured === false || status?.schemaAvailable === false} onClick={connect}>{status?.connected && status.needsUpgrade ? 'Reconnect to enable event management' : reconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</button>}
          {canManage && localDate && !settings && <button type="button" className={buttonClass} disabled={busy || locked || !writableCalendars.length} onClick={() => setEditor({ event: null })}>New Google event</button>}
          {status?.connected && <button type="button" className={buttonClass} disabled={busy || writing} onClick={refresh}>Refresh</button>}
          {settings && status?.connected && <button type="button" className={buttonClass} disabled={busy || locked} onClick={disconnect}>Disconnect</button>}
          {error && !status?.connected && <button type="button" className={buttonClass} disabled={busy || !userId} onClick={refresh}>Retry</button>}
        </div>
      </div>
      <p className="text-xs text-zinc-500">Your local plan stays in Retaliate. Connecting or disconnecting does not change it.</p>
      <p className="text-xs text-zinc-400">Google consent allows viewing calendars and creating, editing, or deleting events on writable calendars. It does not allow managing calendars or exporting commitments.</p>
      {status?.needsUpgrade && <p className="text-xs text-amber-300">Your existing connection can still show availability. Reconnect to grant event management permission.</p>}
      {canManage && visibleEvents.some(canEdit) && <details>
        <summary className="cursor-pointer text-xs text-zinc-300">Manage Google events</summary>
        <ul className="mt-2 space-y-2">{visibleEvents.filter(canEdit).map((event) => <li key={`${event.calendarId}:${event.eventId}`}><button type="button" className={buttonClass} disabled={busy || locked} onClick={() => controls.edit(event)}>Edit {event.title || 'Untitled event'}{event.allDay ? ' (all-day)' : ''}</button></li>)}</ul>
      </details>}
      {status?.connected && status.configured !== false && status.schemaAvailable !== false && <p className="text-xs text-zinc-400">{status.selectedCalendarIds?.length ? `${status.selectedCalendarIds.length} calendar(s) saved for import. Apply changes to save your selection.` : 'No calendars selected. Nothing is imported; choose calendars and apply to show availability.'}</p>}
      {status?.connected && status.configured !== false && status.schemaAvailable !== false && (calendars.length > 0 || selected.length > 0 || status.selectedCalendarIds?.length > 0) && (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-300">Choose calendars ({selected.length})</summary>
          <fieldset disabled={locked} className="mt-2 space-y-2">
            <legend className="sr-only">Calendars to display</legend>
            {[...calendars, ...selected.filter((id) => !calendars.some((calendar) => calendar.id === id)).map((id) => ({ id, name: `Unavailable calendar (${id})` }))].map((calendar) => (
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
        {callbackResult === 'error' && <p className="text-amber-300">Google connection could not be completed. Retry connecting; your local plan is unchanged.</p>}
        {(busy || writing) && <p>Updating calendar…</p>}
        {error && <p className="text-amber-300">{error} Your review is still available.</p>}
        {warning && <p className="text-amber-300">{warning}</p>}
        {stale && <p className="text-amber-300">Showing cached calendar events — they may be out of date.</p>}
      </div>
      {editor && canManage && <GoogleCalendarEventEditor
        event={editor.event}
        calendars={editor.event && !writableCalendars.some((calendar) => calendar.id === editor.event.calendarId)
          ? [...writableCalendars, { id: editor.event.calendarId }] : writableCalendars}
        localDate={localDate}
        timezone={timezone}
        disabled={locked || busy || !canManage}
        onClose={() => setEditor(null)}
        onSave={(body) => mutate(editor.event ? 'update' : 'create', editor.event, body)}
        onDelete={() => mutate('delete', editor.event)}
      />}
    </div>
  );
}
