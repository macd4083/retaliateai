import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
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
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

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
    expect(container.textContent).toContain('Showing cached calendar events');
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
});
