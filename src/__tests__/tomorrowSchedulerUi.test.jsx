import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as scheduling from '../v2/today/scheduling';

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

  it('exposes unavailable pending-schedule errors without claiming completion is allowed', async () => {
    await render({ available: false, saveError: new Error('Scheduling is unavailable. Pending schedule changes are saved locally; retry before completing.') });
    expect(container.textContent).toContain('Pending schedule changes are saved locally');
    expect(container.textContent).toContain('Retry scheduling before completing your review');
    expect(container.textContent).not.toContain('You can still save your actions and complete your review');
  });

  it('isolates an unsupported timezone to a scheduler diagnostic instead of throwing from render', async () => {
    await render({ timezone: 'Unsupported/Nowhere', blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    expect(container.textContent).toContain('Timeline unavailable for this date or timezone. Your review is still available.');
    expect(container.querySelector('[data-slot-timestamp]')).toBeNull();
    expect(container.textContent).not.toContain('Google connection');
    expect(update).not.toHaveBeenCalled();
  });

  it('isolates skipped-date day-bound failures without mounting timeline or calendar controls', async () => {
    const bounds = vi.spyOn(scheduling, 'getScheduleDateBounds').mockImplementationOnce(() => { throw new Error('This local date was skipped.'); });
    try {
      await render({ localDate: '2011-12-30', timezone: 'Pacific/Apia' });
      expect(container.textContent).toContain('This local date was skipped.');
      expect(container.textContent).toContain('Your review is still available.');
      expect(container.querySelector('[data-slot-timestamp]')).toBeNull();
    } finally {
      bounds.mockRestore();
    }
  });

  it('has 96 slots and shows a scheduled item only once, outside the tray', async () => {
    await render({ blocks: [{ id: 'block', source_key: 'action-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    expect(container.textContent).toContain('Unscheduled (1)');
    expect(container.textContent.match(/Write a chapter/g)).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
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

  it('renders 25 elapsed hours with separate timestamp slots and positions for repeated wall times', async () => {
    await render({ localDate: '2026-11-01', timezone: 'America/New_York', blocks: [
      { source_key: 'action-1', starts_at: '2026-11-01T05:30:00Z', ends_at: '2026-11-01T05:45:00Z' },
      { source_key: 'habit-1', starts_at: '2026-11-01T06:30:00Z', ends_at: '2026-11-01T06:45:00Z' },
    ] });
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(100);
    expect(container.querySelector('[aria-label^="25-hour timeline"]')).toBeTruthy();
    expect(container.querySelector('[data-slot-timestamp="2026-11-01T05:30:00.000Z"]')).toBeTruthy();
    expect(container.querySelector('[data-slot-timestamp="2026-11-01T06:30:00.000Z"]')).toBeTruthy();
    expect(container.querySelector('[data-schedule-key="action-1"]').style.top).toBe('216px');
    expect(container.querySelector('[data-schedule-key="habit-1"]').style.top).toBe('360px');
    expect(container.textContent).toContain('GMT-4');
    expect(container.textContent).toContain('GMT-5');
  });

  it('uses real elapsed height when a block crosses the fallback transition', async () => {
    await render({ localDate: '2026-11-01', timezone: 'America/New_York', blocks: [
      { source_key: 'action-1', starts_at: '2026-11-01T05:45:00Z', ends_at: '2026-11-01T06:15:00Z' },
    ] });
    expect(container.querySelector('[data-schedule-key="action-1"]').style.height).toBe('72px');
    expect(container.textContent).toContain('01:45–01:15 (GMT-4 → GMT-5)');
  });

  it('renders 23 elapsed hours with no nonexistent spring-forward slots', async () => {
    await render({ localDate: '2026-03-08', timezone: 'America/New_York' });
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(92);
    expect(container.querySelector('[aria-label^="23-hour timeline"]')).toBeTruthy();
    expect(container.textContent).not.toContain('02:00');
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

  it('exposes recoverable offline synchronization status', async () => {
    await render({ saveStatus: 'offline' });
    expect(container.textContent).toContain('Schedule saved on this device — reconnect to sync.');
  });

  it('allows keyboard handle editing and restores focus when canceled', async () => {
    await render();
    const handle = container.querySelector('[aria-label^="Drag Write a chapter"]');
    handle.focus();
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await click('Cancel');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(handle);
  });

  it('unschedules through the explicit source identity without removing the item', async () => {
    const unschedule = vi.fn();
    await render({ onUnschedule: unschedule, blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    await click('Write a chapter');
    await click('Unschedule');
    expect(unschedule).toHaveBeenCalledWith('action-1');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a cross-midnight block on its start planning date with an explicit next-day label', async () => {
    await render({ blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' }] });
    expect(container.textContent).toContain('23:45–00:15 (+1 day)');
    expect(container.querySelector('[data-schedule-key="action-1"]').style.height).toBe('36px');
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="number"]').value).toBe('30');
  });

  it('shows previous-day carryover read-only and warns against scheduling through it', async () => {
    await render({
      blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T00:15:00Z', ends_at: '2026-10-07T00:45:00Z' }],
      contextBlocks: [{ id: 'previous-block', source_id: 'previous-action', target_local_date: '2026-10-06', label: 'Late work', starts_at: '2026-10-06T23:30:00Z', ends_at: '2026-10-07T00:30:00Z' }],
    });
    const context = container.querySelector('[data-context-schedule-id="previous-block"]');
    expect(context.textContent).toContain('Previous-day · 2026-10-06 · read-only');
    expect(context.style.height).toBe('72px');
    expect(context.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('Unscheduled (1)');
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves read-only schedule evidence without exposing archived sources in the editable tray', async () => {
    const props = { items: [], blocks: [{ id: 'preserved', source_key: 'habit:archived', source_type: 'habit', label: 'Past reading', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] };
    await render({ ...props, readOnly: true });
    const preserved = container.querySelector('[data-schedule-key="habit:archived"]');
    expect(preserved.textContent).toContain('Past reading');
    expect(preserved.textContent).toContain('Preserved plan · read-only');
    expect(preserved.querySelector('button')).toBeNull();
    await render({ ...props, readOnly: false });
    expect(container.textContent).not.toContain('Past reading');
  });

  it('keeps scheduled controls bounded while preserving long labels and times in their accessible names', async () => {
    const label = 'Write a detailed chapter with a very long descriptive commitment label';
    await render({ items: [{ ...items[0], label }], blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    const card = container.querySelector('[data-schedule-key="action-1"]');
    const button = card.querySelector('[data-scheduler-edit-key="action-1"]');
    expect(card.style.height).toBe('72px');
    expect(card.firstElementChild.classList.contains('h-full')).toBe(true);
    expect(card.firstElementChild.classList.contains('overflow-hidden')).toBe(true);
    expect(button.getAttribute('aria-label')).toContain(label);
    expect(button.getAttribute('aria-label')).toContain('09:00–09:30');
    expect(button.querySelector('.line-clamp-2')).toBeTruthy();
  });

  it('restores focus to the new scheduled control after saving removes the original tray trigger', async () => {
    function ControlledScheduler() {
      const [savedBlocks, setSavedBlocks] = React.useState([]);
      return <TomorrowScheduler userId="user" localDate="2026-10-07" timezone="UTC" items={items} blocks={savedBlocks} onUpdate={(key, times) => setSavedBlocks([{ source_key: key, ...times }])} onUnschedule={vi.fn()} />;
    }
    await act(async () => root.render(<ControlledScheduler />));
    const original = container.querySelector('[data-scheduler-edit-key="action-1"]');
    original.focus();
    await act(async () => original.click());
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const scheduled = container.querySelector('[data-schedule-key="action-1"] [data-scheduler-edit-key="action-1"]');
    expect(scheduled).toBeTruthy();
    expect(document.activeElement).toBe(scheduled);
  });
});
