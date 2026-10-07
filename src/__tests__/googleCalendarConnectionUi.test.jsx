import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../lib/supabase/client', () => ({ supabase: { auth } }));
import GoogleCalendarConnection from '../v2/components/GoogleCalendarConnection';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('GoogleCalendarConnection UI contract', () => {
  let root;
  let container;
  let events;
  let fetchMock;
  let sequence = 0;
  const response = (data, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => data });
  const render = async (props = {}) => act(async () => root.render(<GoogleCalendarConnection userId={`user-${sequence}`} localDate="2026-11-01" timezone="America/New_York" onEvents={events} {...props} />));
  const click = async (text) => {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  beforeEach(() => {
    sequence += 1;
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session' } } });
    auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
    events = vi.fn();
    fetchMock = vi.fn((url) => {
      const action = new URL(url, 'https://example.invalid').searchParams.get('action');
      if (action === 'status') return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: ['primary'] });
      if (action === 'calendars') return response({ calendars: [{ id: 'primary', name: 'Personal' }], selectedCalendarIds: ['primary'] });
      if (action === 'events') return response({ events: [{ id: 'event', title: 'Meeting', start: '2026-11-01T14:00:00Z', end: '2026-11-01T15:00:00Z', allDay: false, transparency: 'opaque' }] });
      return response({ connected: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

  it('uses authenticated API requests and a timezone-aware 25-hour DST date range', async () => {
    await render();
    const eventRequest = fetchMock.mock.calls.find(([url]) => url.includes('action=events'));
    const url = new URL(eventRequest[0], 'https://example.invalid');
    expect(url.searchParams.get('timeMin')).toBe('2026-11-01T04:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-11-02T05:00:00.000Z');
    expect(eventRequest[1].headers.Authorization).toBe(['Bearer', 'test-session'].join(' '));
    expect(eventRequest[1].credentials).toBe('same-origin');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect(container.textContent).toContain('Choose calendars (1)');
  });
  it('fetches next-day busy events through 24 elapsed hours beyond a 25-hour DST day when requested', async () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=events')
      ? response({ events: [{ id: 'spillover', title: 'Next-day meeting', start: '2026-11-02T05:15:00Z', end: '2026-11-02T05:45:00Z' }] }) : original(url, options));
    await render({ includeNextDay: true });
    const url = new URL(fetchMock.mock.calls.find(([url]) => url.includes('action=events'))[0], 'https://example.invalid');
    expect(url.searchParams.get('timeMin')).toBe('2026-11-01T04:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-11-03T05:00:00.000Z');
    expect(Date.parse(url.searchParams.get('timeMax')) - Date.parse(url.searchParams.get('timeMin'))).toBe(49 * 60 * 60 * 1000);
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Next-day meeting');
  });
  it('does not reuse day-only cached events for the spillover view', async () => {
    await render();
    let resolveStatus;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    await render({ includeNextDay: true });
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    await act(async () => resolveStatus(await response({ connected: false, configured: true, schemaAvailable: true })));
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
  });

  it('keeps cached events and labels them stale if refresh fails', async () => {
    await render();
    fetchMock.mockImplementation(() => response({ error: 'Calendar unavailable', code: 'google_error' }, 503));
    await click('Refresh');
    expect(container.textContent).toContain('Showing cached calendar events');
    expect(container.textContent).toContain('Your review is still available');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
  });

  it('disconnects without writing local schedule data', async () => {
    await render({ settings: true });
    await click('Disconnect');
    const request = fetchMock.mock.calls.find(([url]) => url.includes('action=disconnect'));
    expect(request[1].method).toBe('POST');
    expect(request[1].body).toBe('{}');
    expect(container.textContent).toContain('Your local plan stays');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
  });

  it('offers reconnect when Google authorization has expired', async () => {
    await render();
    fetchMock.mockImplementation(() => response({ error: 'Reconnect your calendar', code: 'reconnect_required' }, 401));
    await click('Refresh');
    expect(container.textContent).toContain('Reconnect Google');
    expect(container.textContent).not.toContain('Showing cached calendar events');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
  });

  it('uses the exact connection label and disables it when configuration is unavailable', async () => {
    fetchMock.mockImplementation(() => response({ connected: false, configured: false, schemaAvailable: false, message: 'Google Calendar is not configured.' }));
    await render();
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Connect Google Calendar');
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain('Google Calendar is not configured.');
  });

  it('clears cached event state when the account changes', async () => {
    await render();
    fetchMock.mockImplementation(() => response({ error: 'Unavailable', code: 'google_error' }, 503));
    await render({ userId: 'different-user' });
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).not.toContain('Showing cached calendar events');
  });

  it('posts selected calendars using the exact authenticated camelCase payload', async () => {
    await render();
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    await click('Apply calendars');
    const request = fetchMock.mock.calls.find(([url]) => url.includes('action=select'));
    expect(request[1].method).toBe('POST');
    expect(JSON.parse(request[1].body)).toEqual({ calendarIds: [] });
    expect(request[1].headers['Content-Type']).toBe('application/json');
    expect(request[1].credentials).toBe('same-origin');
  });

  it('posts the OAuth returnPath and rejects an unexpected authorization destination', async () => {
    window.history.replaceState({}, '', '/settings');
    fetchMock.mockImplementation((url) => {
      if (url.includes('action=connect')) return response({ authorizationUrl: 'https://unexpected.example/authorize' });
      return response({ connected: false, configured: true, schemaAvailable: true, selectedCalendarIds: [] });
    });
    await render({ settings: true });
    await click('Connect Google Calendar');
    const request = fetchMock.mock.calls.find(([url]) => url.includes('action=connect'));
    expect(JSON.parse(request[1].body)).toEqual({ returnPath: '/settings' });
    expect(request[1].method).toBe('POST');
    expect(request[1].credentials).toBe('same-origin');
    expect(container.textContent).toContain('Invalid Google connection link.');
  });

  it('marks previously cached events stale immediately while a remount refresh is pending', async () => {
    await render();
    await act(async () => root.unmount());
    root = createRoot(container);
    let resolveStatus;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    await render();
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect(container.textContent).toContain('Showing cached calendar events');
    await act(async () => resolveStatus(await response({ connected: false, configured: true, schemaAvailable: true })));
    expect(container.textContent).not.toContain('Showing cached calendar events');
  });

  it('marks the current calendar view stale during a throttled resume refresh', async () => {
    await render();
    const resumedAt = Date.now() + 60_001;
    vi.spyOn(Date, 'now').mockReturnValue(resumedAt);
    let resolveStatus;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.textContent).toContain('Showing cached calendar events');
    await act(async () => resolveStatus(await response({ connected: false, configured: true, schemaAvailable: true })));
    expect(container.textContent).not.toContain('Showing cached calendar events');
  });

  it('does not repopulate shared cache from a request started before Settings disconnects', async () => {
    await render();
    const settingsContainer = document.createElement('div');
    document.body.appendChild(settingsContainer);
    const settingsRoot = createRoot(settingsContainer);
    try {
      await act(async () => settingsRoot.render(<GoogleCalendarConnection userId={`user-${sequence}`} settings />));
      const originalFetch = fetchMock.getMockImplementation();
      let resolveEvents;
      fetchMock.mockImplementation((url, options) => url.includes('action=events') ? new Promise((resolve) => { resolveEvents = resolve; }) : originalFetch(url, options));
      await click('Refresh');
      const disconnect = [...settingsContainer.querySelectorAll('button')].find((node) => node.textContent === 'Disconnect');
      await act(async () => disconnect.click());
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      expect(container.textContent).not.toContain('Showing cached calendar events');
      await act(async () => resolveEvents(await response({ events: [{ id: 'late', title: 'Should not return' }] })));
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      await act(async () => root.unmount());
      root = createRoot(container);
      events.mockClear();
      fetchMock.mockImplementation(() => response({ connected: false, configured: true, schemaAvailable: true }));
      await render();
      expect(events.mock.calls.some(([rows]) => rows.some((event) => event.title === 'Should not return'))).toBe(false);
    } finally {
      await act(async () => settingsRoot.unmount());
      settingsContainer.remove();
    }
  });
  it('clears Today overlays when Settings discovers revoked authorization', async () => {
    await render();
    const settingsContainer = document.createElement('div');
    document.body.appendChild(settingsContainer);
    const settingsRoot = createRoot(settingsContainer);
    try {
      await act(async () => settingsRoot.render(<GoogleCalendarConnection userId={`user-${sequence}`} settings />));
      const original = fetchMock.getMockImplementation();
      fetchMock.mockImplementation((url, options) => url.includes('action=calendars')
        ? response({ error: 'Authorization revoked', code: 'reconnect_required' }, 401) : original(url, options));
      await act(async () => [...settingsContainer.querySelectorAll('button')].find((button) => button.textContent === 'Refresh').click());
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      expect(container.textContent).toContain('Reconnect Google Calendar');
      expect(container.textContent).not.toContain('Showing cached calendar events');
      await act(async () => root.unmount());
      root = createRoot(container);
      fetchMock.mockImplementation(() => response({ connected: false, configured: true, schemaAvailable: true }));
      events.mockClear();
      await render();
      expect(events.mock.calls.every(([rows]) => rows.length === 0)).toBe(true);
    } finally {
      await act(async () => settingsRoot.unmount());
      settingsContainer.remove();
    }
  });

  it('keeps Disconnect usable for an existing connection after server configuration is removed', async () => {
    fetchMock.mockImplementation((url) => url.includes('action=disconnect')
      ? response({ connected: false, selectedCalendarIds: [] })
      : response({ connected: true, configured: false, schemaAvailable: true, selectedCalendarIds: ['primary'], message: 'Calendar credentials are unavailable.' }));
    await render({ settings: true });
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(container.textContent).toContain('Calendar credentials are unavailable.');
    const disconnect = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Disconnect');
    expect(disconnect.disabled).toBe(false);
    await click('Disconnect');
    const connect = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Connect Google Calendar');
    expect(connect.disabled).toBe(true);
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
  });

  it('clears imported calendar events and skips further imports when configuration becomes unavailable', async () => {
    await render();
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => response({ connected: true, configured: false, schemaAvailable: true, selectedCalendarIds: ['primary'], message: 'Calendar configuration is unavailable.' }));
    await click('Refresh');
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('action=status');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).not.toContain('Choose calendars');
    expect(container.textContent).not.toContain('Showing cached calendar events');
  });
  it.each(['/today', '/settings'])('explains denied and failed OAuth returns on %s without changing the local plan', async (path) => {
    window.history.replaceState({}, '', `${path}?googleCalendar=denied`);
    await render({ settings: path === '/settings' });
    expect(container.textContent).toContain('Google connection was canceled.');
    window.history.replaceState({}, '', `${path}?googleCalendar=error`);
    await render({ settings: path === '/settings' });
    expect(container.textContent).toContain('Google connection could not be completed.');
    expect(container.textContent).toContain('your local plan is unchanged.');
    expect(fetchMock.mock.calls.every(([url, options]) => !url.includes('action=connect') && options.method === 'GET')).toBe(true);
  });
  it('explains persisted multiple selections and explicit empty selections without importing a default', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.includes('action=status')) return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: ['primary', 'work'] });
      if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary', name: 'Personal' }, { id: 'work', name: 'Work' }], selectedCalendarIds: ['primary', 'work'] });
      return response({ events: [] });
    });
    await render();
    expect(container.textContent).toContain('Choose calendars (2)');
    expect([...container.querySelectorAll('input')].every((input) => input.checked)).toBe(true);
    fetchMock.mockImplementation((url) => {
      if (url.includes('action=status')) return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: [] });
      if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary', name: 'Personal' }], selectedCalendarIds: [] });
      return response({ events: [] });
    });
    await click('Refresh');
    expect(container.textContent).toContain('No calendars selected. Nothing is imported');
    expect(container.querySelector('input').checked).toBe(false);
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
  });
  it('retries initial status errors rather than enabling Connect with unknown configuration', async () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(() => response({ error: 'Storage unavailable' }, 503));
    await render();
    const connect = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Connect Google Calendar');
    expect(connect.disabled).toBe(true);
    expect(container.textContent).toContain('Retry');
    fetchMock.mockImplementation(original);
    await click('Retry');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
  });
  it('shows partial availability explicitly and keeps unavailable persisted calendars removable', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.includes('action=status')) return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: ['primary', 'removed'] });
      if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary', name: 'Personal' }], selectedCalendarIds: ['primary', 'removed'] });
      return response({ events: [{ id: 'healthy', title: 'Healthy calendar' }], partial: true, unavailableCalendars: [{ calendarId: 'removed' }] });
    });
    await render();
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Healthy calendar');
    expect(container.textContent).toContain('Showing partial availability');
    expect(container.textContent).toContain('do not assume the remaining time is free');
    expect(container.textContent).toContain('Unavailable calendar (removed)');
    expect(container.querySelectorAll('input')).toHaveLength(2);
  });
  it('imports saved selections even when calendar choices cannot be loaded', async () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=calendars') ? response({ error: 'Page limit reached' }, 502) : original(url, options));
    await render();
    expect(container.textContent).toContain('Saved selections are unchanged');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect(container.textContent).toContain('Refresh');
  });
  it('ignores late responses from a previous date', async () => {
    const original = fetchMock.getMockImplementation();
    let resolveOld;
    fetchMock.mockImplementation((url, options) => url.includes('action=events') && url.includes('2026-11-01T04')
      ? new Promise((resolve) => { resolveOld = resolve; }) : original(url, options));
    await render();
    await render({ localDate: '2026-11-02' });
    await act(async () => resolveOld(await response({ events: [{ id: 'old', title: 'Wrong date' }] })));
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect(events.mock.calls.some(([rows]) => rows.some((event) => event.title === 'Wrong date'))).toBe(false);
  });
  it('ignores a late selection save error after the account changes', async () => {
    await render();
    const original = fetchMock.getMockImplementation();
    let resolveSelection;
    fetchMock.mockImplementation((url, options) => url.includes('action=select') ? new Promise((resolve) => { resolveSelection = resolve; }) : original(url, options));
    await click('Apply calendars');
    await render({ userId: 'new-account' });
    await act(async () => resolveSelection(await response({ error: 'Old account failure' }, 503)));
    expect(container.textContent).not.toContain('Old account failure');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
  });
  it('invalidates cached overlays on selection save before a failed refresh can display the old selection', async () => {
    await render();
    await act(async () => container.querySelector('input').click());
    fetchMock.mockImplementation((url) => url.includes('action=select')
      ? response({ selectedCalendarIds: [] }) : response({ error: 'Unavailable after selection' }, 503));
    await click('Apply calendars');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).not.toContain('Showing cached calendar events');
    expect(container.textContent).toContain('Unavailable after selection');
  });
  it('ignores in-flight events when Settings saves a new selection', async () => {
    await render();
    const settingsContainer = document.createElement('div');
    document.body.appendChild(settingsContainer);
    const settingsRoot = createRoot(settingsContainer);
    let selected = ['primary'];
    let resolveOld;
    const original = fetchMock.getMockImplementation();
    try {
      await act(async () => settingsRoot.render(<GoogleCalendarConnection userId={`user-${sequence}`} settings />));
      fetchMock.mockImplementation((url, options) => {
        if (url.includes('action=select')) {
          selected = JSON.parse(options.body).calendarIds;
          return response({ selectedCalendarIds: selected });
        }
        if (url.includes('action=status')) return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: selected });
        if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary', name: 'Personal' }], selectedCalendarIds: selected });
        if (url.includes('action=events')) return selected.length ? new Promise((resolve) => { resolveOld = resolve; }) : response({ events: [] });
        return original(url, options);
      });
      await click('Refresh');
      await act(async () => settingsContainer.querySelector('input').click());
      await act(async () => [...settingsContainer.querySelectorAll('button')].find((button) => button.textContent === 'Apply calendars').click());
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      await act(async () => resolveOld(await response({ events: [{ id: 'old-selection', title: 'Old selection' }] })));
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      expect(container.textContent).toContain('No calendars selected');
      expect(container.textContent).not.toContain('Showing cached calendar events');
    } finally {
      await act(async () => settingsRoot.unmount());
      settingsContainer.remove();
    }
  });
  it('clears cached overlays when the Supabase session disappears during refresh', async () => {
    await render();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await click('Refresh');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).not.toContain('Showing cached calendar events');
    expect(container.textContent).toContain('Please sign in again');
  });
  it('clears overlays immediately on signout and ignores pending results', async () => {
    await render();
    let resolveOld;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
    await click('Refresh');
    const signedOut = auth.onAuthStateChange.mock.calls.at(-1)[0];
    await act(async () => signedOut('SIGNED_OUT'));
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).not.toContain('Showing cached calendar events');
    await act(async () => resolveOld(await response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: ['primary'] })));
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
  });
  it('does not send a request using another authenticated account session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'other-session', user: { id: 'other-account' } } } });
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).toContain('Please sign in again');
  });
  it('retains partial-availability disclosure with cached events while a remount refresh is pending', async () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=events')
      ? response({ events: [{ id: 'healthy', title: 'Healthy' }], partial: true, unavailableCalendars: [{ calendarId: 'missing' }] }) : original(url, options));
    await render();
    await act(async () => root.unmount());
    root = createRoot(container);
    let resolveStatus;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    await render();
    expect(container.textContent).toContain('Showing partial availability');
    expect(container.textContent).toContain('Showing cached calendar events');
    await act(async () => resolveStatus(await response({ connected: false, configured: true, schemaAvailable: true })));
    expect(container.textContent).not.toContain('Showing partial availability');
  });
  it.each(['https://accounts.google.com:444/o/oauth2/v2/auth', 'https://accounts.google.com/other', 'https://attacker@accounts.google.com/o/oauth2/v2/auth'])('rejects unsafe OAuth navigation: %s', async (authorizationUrl) => {
    fetchMock.mockImplementation((url) => url.includes('action=connect') ? response({ authorizationUrl }) : response({ connected: false, configured: true, schemaAvailable: true }));
    await render();
    await click('Connect Google Calendar');
    expect(container.textContent).toContain('Invalid Google connection link.');
  });
});
