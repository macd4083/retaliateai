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
  const editableEvent = {
    id: 'google:primary:occurrence', eventId: 'occurrence', calendarId: 'primary', etag: '"version-1"',
    title: 'Meeting', start: '2026-11-01T14:00:00Z', end: '2026-11-01T15:00:00Z',
    allDay: false, editable: true, recurringEventId: 'series', timeZone: 'America/New_York',
  };
  const enableManagement = () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('action=status')) return response({ connected: true, canWrite: true, selectedCalendarIds: ['primary'] });
      if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary', summary: 'Personal', accessRole: 'owner' }, { id: 'read', summary: 'Read only', accessRole: 'reader' }, { id: 'unselected', summary: 'Other writable', accessRole: 'writer' }], selectedCalendarIds: ['primary'] });
      if (url.includes('action=events')) return response({ events: [editableEvent, { ...editableEvent, id: 'read', eventId: 'readonly', editable: false, title: 'Read-only event' }] });
      return original(url, options);
    });
  };

  it('creates Google events independently using only writable destinations including unselected calendars', async () => {
    enableManagement();
    await render();
    await click('New Google event');
    const select = document.querySelector('[aria-label="Destination calendar"]');
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['primary', 'unselected']);
    await act(async () => {
      const title = document.querySelector('[aria-label="Event title"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, 'New meeting');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const request = fetchMock.mock.calls.find(([url]) => url.includes('action=create'));
    expect(request[1].method).toBe('POST');
    expect(JSON.parse(request[1].body)).toMatchObject({ calendarId: 'primary', requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), event: { summary: 'New meeting' } });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers stable edit/update controls and awaits an authenticated resize before refreshing', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const controls = onControls.mock.calls.at(-1)[0];
    const original = fetchMock.getMockImplementation();
    let resolveUpdate;
    fetchMock.mockImplementation((url, options) => url.includes('action=update') ? new Promise((resolve) => { resolveUpdate = resolve; }) : original(url, options));
    const eventCalls = fetchMock.mock.calls.filter(([url]) => url.includes('action=events')).length;
    let updatePromise;
    await act(async () => { updatePromise = controls.update(editableEvent, { starts_at: '2026-11-01T14:00:00Z', ends_at: '2026-11-01T16:00:00Z' }); });
    const request = fetchMock.mock.calls.find(([url]) => url.includes('action=update'));
    expect(JSON.parse(request[1].body)).toEqual({ calendarId: 'primary', eventId: 'occurrence', etag: '"version-1"', event: {
      start: { dateTime: '2026-11-01T14:00:00.000Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-01T16:00:00.000Z', timeZone: 'America/New_York' },
    } });
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('action=events'))).toHaveLength(eventCalls);
    await act(async () => resolveUpdate(await response({ event: editableEvent })));
    await act(async () => updatePromise);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('action=events'))).toHaveLength(eventCalls + 1);
    await render({ onControls });
    expect(onControls.mock.calls.at(-1)[0]).toBe(controls);
  });

  it('deletes only the selected recurring occurrence with etag after explicit confirmation', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    await act(async () => onControls.mock.calls.at(-1)[0].edit(editableEvent));
    const portalClick = async (text) => act(async () => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === text).click());
    await portalClick('Delete Google event');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('action=delete'))).toBe(false);
    await portalClick('Confirm delete');
    const request = fetchMock.mock.calls.find(([url]) => url.includes('action=delete'));
    expect(JSON.parse(request[1].body)).toEqual({ calendarId: 'primary', eventId: 'occurrence', etag: '"version-1"' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('retains events after resize failure and permits a retry without a stuck pending state', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const controls = onControls.mock.calls.at(-1)[0];
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=update') ? response({ error: 'Event changed; refresh first', code: 'event_conflict' }, 409) : original(url, options));
    const times = { starts_at: editableEvent.start, ends_at: editableEvent.end };
    await act(async () => { await expect(controls.update(editableEvent, times)).rejects.toThrow('Event changed'); });
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect(container.textContent).not.toContain('Updating calendar');
    fetchMock.mockImplementation(original);
    await act(async () => controls.update(editableEvent, times));
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('action=update'))).toHaveLength(2);
    expect(container.textContent).not.toContain('Event changed');
  });

  it('rejects duplicate writes, recovers after failure, and preserves availability for permission upgrades', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const controls = onControls.mock.calls.at(-1)[0];
    const original = fetchMock.getMockImplementation();
    let resolveUpdate;
    fetchMock.mockImplementation((url, options) => url.includes('action=update') ? new Promise((resolve) => { resolveUpdate = resolve; }) : original(url, options));
    const times = { starts_at: '2026-11-01T14:00:00Z', ends_at: '2026-11-01T16:00:00Z' };
    let promise;
    await act(async () => { promise = controls.update(editableEvent, times).catch((error) => error); });
    await act(async () => { await expect(controls.update(editableEvent, times)).rejects.toThrow('locked'); });
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('action=update'))).toHaveLength(1);
    await act(async () => resolveUpdate(await response({ code: 'permission_upgrade_required', error: 'Grant event permissions' }, 403)));
    await act(async () => promise);
    expect(container.textContent).toContain('Reconnect to enable event management');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Reconnect to enable event management').disabled).toBe(false);
  });

  it('allows legacy grants to view availability and clearly offers event permission upgrade', async () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=status')
      ? response({ connected: true, canWrite: false, needsUpgrade: true, selectedCalendarIds: ['primary'] }) : original(url, options));
    await render();
    expect(container.textContent).toContain('Reconnect to enable event management');
    expect(container.textContent).not.toContain('New Google event');
    expect(events.mock.calls.at(-1)[0][0].title).toBe('Meeting');
    expect(container.textContent).toContain('does not allow managing calendars');
  });

  it('locks writes through stable controls and forms once completion starts', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const controls = onControls.mock.calls.at(-1)[0];
    await act(async () => controls.edit(editableEvent));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await render({ onControls, completionSaving: true });
    expect(document.querySelector('fieldset').disabled).toBe(true);
    await act(async () => { await expect(controls.update(editableEvent, { starts_at: editableEvent.start, ends_at: editableEvent.end })).rejects.toThrow('locked'); });
    expect(fetchMock.mock.calls.some(([url]) => url.includes('action=update'))).toBe(false);
  });

  it('does not offer read-only event editing or permit all-day drag resizing', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const controls = onControls.mock.calls.at(-1)[0];
    await act(async () => controls.edit({ ...editableEvent, editable: false }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain('Edit Read-only event');
    await act(async () => {
      await expect(controls.update({ ...editableEvent, editable: false }, { starts_at: editableEvent.start, ends_at: editableEvent.end })).rejects.toThrow('read-only');
      await expect(controls.update({ ...editableEvent, allDay: true }, { starts_at: editableEvent.start, ends_at: editableEvent.end })).rejects.toThrow('date fields');
    });
    expect(fetchMock.mock.calls.some(([url]) => url.includes('action=update'))).toBe(false);
  });

    it('blocks synchronous writes once a refresh starts before busy state rerenders', async () => {
      enableManagement();
      const onControls = vi.fn();
      await render({ onControls });
      const controls = onControls.mock.calls.at(-1)[0];
      let resolveStatus;
      const original = fetchMock.getMockImplementation();
      fetchMock.mockImplementation((url, options) => url.includes('action=status') ? new Promise((resolve) => { resolveStatus = resolve; }) : original(url, options));
      await act(async () => {
        Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Refresh').click();
        await expect(controls.update(editableEvent, { starts_at: editableEvent.start, ends_at: editableEvent.end })).rejects.toThrow('locked');
      });
      expect(fetchMock.mock.calls.some(([url]) => url.includes('action=update'))).toBe(false);
      await act(async () => resolveStatus(await response({ connected: true, canWrite: true, selectedCalendarIds: ['primary'] })));
    });

    it('invalidates stale account responses on auth identity changes even when the access token is identical', async () => {
      enableManagement();
      const userId = `user-${sequence}`;
      auth.getSession.mockResolvedValue({ data: { session: { access_token: 'same-token', user: { id: userId } } } });
      const onControls = vi.fn();
      const pending = vi.fn();
      await render({ onControls, onWritePending: pending });
      const original = fetchMock.getMockImplementation();
      let resolveUpdate;
      fetchMock.mockImplementation((url, options) => url.includes('action=update') ? new Promise((resolve) => { resolveUpdate = resolve; }) : original(url, options));
      let promise;
      await act(async () => { promise = onControls.mock.calls.at(-1)[0].update(editableEvent, { starts_at: editableEvent.start, ends_at: editableEvent.end }); });
      expect(pending.mock.calls.at(-1)[0]).toBe(true);
      const authChanged = auth.onAuthStateChange.mock.calls.at(-1)[0];
      await act(async () => authChanged('SIGNED_IN', { access_token: 'same-token', user: { id: 'other-account' } }));
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      expect(pending.mock.calls.at(-1)[0]).toBe(false);
      const count = fetchMock.mock.calls.length;
      await act(async () => resolveUpdate(await response({ event: editableEvent })));
      await act(async () => promise);
      expect(fetchMock.mock.calls).toHaveLength(count);
      expect(events.mock.calls.at(-1)[0]).toEqual([]);
      expect(container.textContent).not.toContain('Manage Google events');
      await act(async () => { await expect(onControls.mock.calls.at(-1)[0].update(editableEvent, { starts_at: editableEvent.start, ends_at: editableEvent.end })).rejects.toThrow('locked'); });
    });

    it('restores focus to the initiating control when the event form closes', async () => {
      enableManagement();
      await render();
      const trigger = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New Google event');
      trigger.focus();
      await click('New Google event');
      expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);
      await act(async () => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Cancel').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

  it('ignores late mutation responses from a previous account and releases busy state', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const original = fetchMock.getMockImplementation();
    let resolveUpdate;
    fetchMock.mockImplementation((url, options) => url.includes('action=update') ? new Promise((resolve) => { resolveUpdate = resolve; }) : original(url, options));
    let promise;
    await act(async () => { promise = onControls.mock.calls.at(-1)[0].update(editableEvent, { starts_at: editableEvent.start, ends_at: editableEvent.end }); });
    await render({ userId: 'another-account', onControls });
    const eventCalls = fetchMock.mock.calls.filter(([url]) => url.includes('action=events')).length;
    await act(async () => resolveUpdate(await response({ event: editableEvent })));
    await act(async () => promise);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('action=events'))).toHaveLength(eventCalls);
    expect(container.textContent).not.toContain('Updating calendar');
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'New Google event').disabled).toBe(false);
  });

  it('does not display late write failures on a different date or keep its editor locked', async () => {
    enableManagement();
    const onControls = vi.fn();
    await render({ onControls });
    const original = fetchMock.getMockImplementation();
    let resolveUpdate;
    fetchMock.mockImplementation((url, options) => url.includes('action=update') ? new Promise((resolve) => { resolveUpdate = resolve; }) : original(url, options));
    let promise;
    await act(async () => { promise = onControls.mock.calls.at(-1)[0].update(editableEvent, { starts_at: editableEvent.start, ends_at: editableEvent.end }).catch((error) => error); });
    await render({ localDate: '2026-11-02', onControls });
    await act(async () => resolveUpdate(await response({ error: 'Old date failure', code: 'google_error' }, 503)));
    await act(async () => promise);
    expect(container.textContent).not.toContain('Old date failure');
    expect(container.textContent).not.toContain('Updating calendar');
    await click('New Google event');
    expect(document.querySelector('fieldset').disabled).toBe(false);
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
  it('clears cached overlays and offers reconnect when selection saving discovers revoked consent', async () => {
    await render();
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=select')
      ? response({ error: 'Calendar consent expired', code: 'reconnect_required' }, 401) : original(url, options));
    await click('Apply calendars');
    expect(container.textContent).toContain('Reconnect Google Calendar');
    expect(container.textContent).toContain('Calendar consent expired');
    expect(container.textContent).not.toContain('Showing cached calendar events');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Reconnect Google Calendar').disabled).toBe(false);
  });
  it('clears cached overlays when another browser disconnects before calendar refresh', async () => {
    await render();
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => url.includes('action=calendars')
      ? response({ error: 'Connect Google Calendar first.', code: 'not_connected' }, 409) : original(url, options));
    await click('Refresh');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).not.toContain('Showing cached calendar events');
    expect(container.textContent).toContain('Connect Google Calendar first.');
    expect(container.textContent).not.toContain('Choose calendars');
  });
  it('does not leave old overlays visible when the session disappears before selection saving', async () => {
    await render();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await click('Apply calendars');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
    expect(container.textContent).toContain('Please sign in again');
    expect(container.textContent).not.toContain('Choose calendars');
    expect(container.textContent).not.toContain('Showing cached calendar events');
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
      await act(async () => Array.from(settingsContainer.querySelectorAll('button')).find((button) => button.textContent === 'Refresh').click());
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
    expect(Array.from(container.querySelectorAll('input')).every((input) => input.checked)).toBe(true);
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
    const connect = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Connect Google Calendar');
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
  it('allows removing the last unavailable calendar and saving an explicit empty selection', async () => {
    let selected = ['removed'];
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('action=status')) return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: selected });
      if (url.includes('action=calendars')) return response({ calendars: [], selectedCalendarIds: selected });
      if (url.includes('action=select')) {
        selected = JSON.parse(options.body).calendarIds;
        return response({ selectedCalendarIds: selected });
      }
      return selected.length ? response({ error: 'Calendar no longer exists', code: 'google_unavailable' }, 502) : response({ events: [] });
    });
    await render();
    expect(container.textContent).toContain('Unavailable calendar (removed)');
    await act(async () => container.querySelector('input').click());
    await click('Apply calendars');
    expect(selected).toEqual([]);
    expect(container.textContent).toContain('No calendars selected. Nothing is imported');
    expect(container.textContent).not.toContain('Unavailable calendar (removed)');
    expect(events.mock.calls.at(-1)[0]).toEqual([]);
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
      await act(async () => Array.from(settingsContainer.querySelectorAll('button')).find((button) => button.textContent === 'Apply calendars').click());
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
