import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoogleCalendarEventEditor from '../v2/components/GoogleCalendarEventEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Google event editor', () => {
  let root;
  let container;
  let save;
  let remove;
  const render = async (props = {}) => act(async () => root.render(<GoogleCalendarEventEditor
    calendars={[{ id: 'work', summary: 'Work' }]} localDate="2026-11-01" timezone="America/New_York"
    onSave={save} onDelete={remove} onClose={vi.fn()} {...props}
  />));
  const input = (label) => document.querySelector(`[aria-label="${label}"]`);
  const fill = async (label, value) => act(async () => {
    const node = input(label);
    const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const click = async (text) => act(async () => {
    const node = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === text);
    expect(node).toBeTruthy();
    node.click();
  });
  const submit = async () => act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    save = vi.fn().mockResolvedValue({});
    remove = vi.fn().mockResolvedValue({});
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('creates an independent event with a UUID and IANA timezone, retaining the request id on retries', async () => {
    await render();
    await fill('Event title', 'Team meeting');
    save.mockRejectedValueOnce(new Error('Retry the request'));
    await submit();
    expect(document.body.textContent).toContain('Retry the request');
    await submit();
    const body = save.mock.calls[0][0];
    expect(body).toMatchObject({
      calendarId: 'work',
      event: { summary: 'Team meeting', start: { dateTime: '2026-11-01T14:00:00.000Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-01T15:00:00.000Z', timeZone: 'America/New_York' } },
    });
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(save.mock.calls[1][0].requestId).toBe(body.requestId);
  });

  it('requires explicit fold choices and preserves the selected occurrence', async () => {
    await render();
    await fill('Event title', 'Clock change');
    await fill('Event start', '2026-11-01T01:15');
    await fill('Event end', '2026-11-01T01:45');
    await submit();
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Ambiguous local time');
    await fill('start clock-change occurrence', 'earlier');
    await fill('end clock-change occurrence', 'later');
    await submit();
    expect(save.mock.calls[0][0].event.start.dateTime).toBe('2026-11-01T05:15:00.000Z');
    expect(save.mock.calls[0][0].event.end.dateTime).toBe('2026-11-01T06:45:00.000Z');
  });

  it('preserves existing folded instants when editing only the title', async () => {
    await render({ event: {
      eventId: 'fold', calendarId: 'work', title: 'Repeated meeting', timeZone: 'America/New_York',
      start: '2026-11-01T06:15:00Z', end: '2026-11-01T06:45:00Z',
    } });
    expect(input('start clock-change occurrence').value).toBe('later');
    expect(input('end clock-change occurrence').value).toBe('later');
    await fill('Event title', 'New title only');
    await submit();
    expect(save.mock.calls[0][0].event).toEqual({ summary: 'New title only' });
  });

  it('uses a summary-only update for unchanged fractional-second boundaries, even for a subsecond event', async () => {
    const event = {
      eventId: 'precise', calendarId: 'work', title: 'Precise event', timeZone: 'America/New_York',
      start: '2026-11-01T14:00:00.125Z', end: '2026-11-01T14:00:00.875Z',
    };
    await render({ event });
    expect(input('Event start').value).toBe(input('Event end').value);
    await fill('Event title', 'Title only');
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].event).toEqual({ summary: 'Title only' });
    expect(event.start).toBe('2026-11-01T14:00:00.125Z');
    expect(event.end).toBe('2026-11-01T14:00:00.875Z');
  });

  it('includes validated start/end boundaries when an existing timed event actually changes', async () => {
    await render({ event: {
      eventId: 'timed', calendarId: 'work', title: 'Meeting', timeZone: 'America/New_York',
      start: '2026-11-01T14:00:00Z', end: '2026-11-01T15:00:00Z',
    } });
    await fill('Event end', '2026-11-01T10:30');
    await submit();
    expect(save.mock.calls[0][0].event).toEqual({
      summary: 'Meeting',
      start: { dateTime: '2026-11-01T14:00:00.000Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-01T15:30:00.000Z', timeZone: 'America/New_York' },
    });
  });

  it('rejects DST gaps even with an occurrence choice', async () => {
    await render({ localDate: '2026-03-08' });
    await fill('Event title', 'Gap');
    await fill('Event start', '2026-03-08T02:15');
    await fill('start clock-change occurrence', 'later');
    await submit();
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('DST gap');
  });

  it('validates timezone and increasing end time', async () => {
    await render();
    await fill('Event title', 'Meeting');
    await fill('Event timezone', 'Invalid/Timezone');
    await submit();
    expect(document.body.textContent).toContain('Choose a valid IANA timezone');
    await fill('Event timezone', 'UTC');
    await fill('Event end', '2026-11-01T08:00');
    await submit();
    expect(document.body.textContent).toContain('End time must be after start time');
    expect(save).not.toHaveBeenCalled();
  });

  it('uses date-only exclusive end values for all-day events', async () => {
    await render({ event: { eventId: 'day', calendarId: 'work', title: 'Holiday', allDay: true, start: '2026-11-01', end: '2026-11-02' } });
    expect(input('Event timezone')).toBeNull();
    expect(input('Event start').type).toBe('date');
    expect(document.body.textContent).toContain('End date is exclusive');
    await fill('Event end', '2026-11-03');
    await submit();
    expect(save.mock.calls[0][0].event).toEqual({ summary: 'Holiday', start: { date: '2026-11-01' }, end: { date: '2026-11-03' } });
    await fill('Event end', '2026-11-01');
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('End date must be after start date');
  });

  it('requires explicit deletion confirmation and explains occurrence-only recurring edits', async () => {
    await render({ event: { eventId: 'occurrence', recurringEventId: 'series', calendarId: 'work', title: 'Standup', start: '2026-11-01T14:00:00Z', end: '2026-11-01T15:00:00Z' } });
    expect(document.body.textContent).toContain('Only this selected occurrence');
    await click('Delete Google event');
    expect(remove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('occurrence only');
    await click('Keep event');
    expect(document.body.textContent).not.toContain('Confirm delete');
    await click('Delete Google event');
    await click('Confirm delete');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(input('Destination calendar').disabled).toBe(true);
  });

  it('locks an open form when completion starts', async () => {
    await render();
    await fill('Event title', 'Meeting');
    await render({ disabled: true });
    await submit();
    expect(document.querySelector('fieldset').disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
