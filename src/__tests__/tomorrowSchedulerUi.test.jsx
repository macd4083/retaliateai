import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calendar = vi.hoisted(() => ({ events: [] }));
vi.mock('../v2/components/GoogleCalendarConnection', () => ({
  default: ({ onEvents }) => {
    React.useEffect(() => onEvents(calendar.events), [onEvents]);
    return <div>Google connection</div>;
  },
}));
import TomorrowScheduler from '../v2/components/TomorrowScheduler';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('TomorrowScheduler UI', () => {
  let root;
  let container;
  let update;
  const items = [{ id: 'action-1', key: 'action-1', type: 'action', label: 'Write a chapter' }, { id: 'habit-1', key: 'habit-1', type: 'habit', label: 'Read' }];
  const render = async (props = {}) => {
    await act(async () => root.render(<TomorrowScheduler userId="user" localDate="2026-10-07" timezone="UTC" items={items} onUpdate={update} onUnschedule={vi.fn()} {...props} />));
  };
  const click = async (text) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(text));
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };

  beforeEach(() => {
    calendar.events = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    update = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows an actionable unavailable message without a calendar or drag targets', async () => {
    await render({ available: false });
    expect(container.textContent).toContain('You can still save your actions and complete your review');
    expect(container.textContent).not.toContain('Google connection');
    expect(container.querySelector('[aria-label^="24-hour"]')).toBeNull();
  });

  it('has 96 slots and shows a scheduled item only once, outside the tray', async () => {
    await render({ blocks: [{ id: 'block', source_key: 'action-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    expect(container.textContent).toContain('Unscheduled (1)');
    expect(container.textContent.match(/Write a chapter/g)).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(96);
    expect(container.textContent).toContain('09:00–09:30');
    expect(container.textContent).toContain('Give your actions a place in the day. Scheduling is optional.');
  });

  it('tap editing opens a labeled focus-trapped dialog and saves a 30-minute estimate', async () => {
    await render();
    await click('Write a chapter');
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Duration estimate (minutes)');
    expect(dialog.querySelector('input[type="time"]').step).toBe('900');
    await act(async () => dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-10-07T09:00:00.000Z', ends_at: '2026-10-07T09:30:00.000Z' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('requires explicit confirmation before saving an overlap', async () => {
    await render({ blocks: [{ source_key: 'habit-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Keep this overlap intentionally');
    expect([...document.querySelectorAll('button')].find((node) => node.textContent === 'Save time').disabled).toBe(true);
    await act(async () => document.querySelector('[role="dialog"] input[type="checkbox"]').click());
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('offers earlier/later choices for a repeated DST time', async () => {
    await render({ localDate: '2026-11-01', timezone: 'America/New_York', blocks: [{ source_key: 'action-1', starts_at: '2026-11-01T05:30:00Z', ends_at: '2026-11-01T05:45:00Z' }] });
    await click('Write a chapter');
    const select = document.querySelector('[role="dialog"] select');
    expect(select).toBeTruthy();
    expect([...select.options].map((option) => option.value)).toEqual(['earlier', 'later']);
  });

  it('preserves the later DST occurrence when editing an existing block', async () => {
    await render({ localDate: '2026-11-01', timezone: 'America/New_York', blocks: [{ source_key: 'action-1', starts_at: '2026-11-01T06:30:00Z', ends_at: '2026-11-01T06:45:00Z' }] });
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] select').value).toBe('later');
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-11-01T06:30:00.000Z', ends_at: '2026-11-01T06:45:00.000Z' });
  });

  it('shows read-only Google events separately and does not block transparent events', async () => {
    calendar.events = [{ id: 'free', title: 'Optional meeting', start: '2026-10-07T09:00:00Z', end: '2026-10-07T10:00:00Z', allDay: false, transparency: 'transparent' }, { id: 'all-day', title: 'Birthday', start: '2026-10-07', end: '2026-10-08', allDay: true, transparency: 'transparent' }];
    await render();
    expect(container.querySelector('[aria-label="Google events"]').textContent).toContain('Optional meeting');
    expect(container.querySelector('[aria-label="All-day Google events"]').textContent).toContain('2026-10-08 (exclusive)');
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeNull();
    expect([...document.querySelectorAll('button')].find((node) => node.textContent === 'Save time').disabled).toBe(false);
  });

  it('requires intentional confirmation for a busy all-day Google event', async () => {
    calendar.events = [{ id: 'all-day', title: 'Away', start: '2026-10-07', end: '2026-10-08', allDay: true, transparency: 'opaque' }];
    await render();
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeTruthy();
  });

  it('preserves a failed editor and exposes the error', async () => {
    update.mockRejectedValue(new Error('Offline: try again'));
    await render();
    await click('Write a chapter');
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Offline: try again');
  });
});
