import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as scheduling from '../v2/today/scheduling';

const calendar = vi.hoisted(() => ({ events: [] }));
const dnd = vi.hoisted(() => ({ handlers: null }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = /** @type {typeof import('@dnd-kit/core')} */ (await importOriginal());
  return {
    ...actual,
    DndContext: (props) => { dnd.handlers = props; return <actual.DndContext {...props} />; },
  };
});
import TomorrowScheduler from '../v2/components/TomorrowScheduler';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('TomorrowScheduler UI', () => {
  let root;
  let container;
  let update;
  const items = [{ id: 'action-1', key: 'action-1', type: 'action', label: 'Write a chapter' }, { id: 'habit-1', key: 'habit-1', type: 'habit', label: 'Read' }];
  const render = async (props = {}) => {
    await act(async () => root.render(<TomorrowScheduler userId="user" localDate="2026-10-07" timezone="UTC" items={items} googleEvents={calendar.events} onUpdate={update} onUnschedule={vi.fn()} {...props} />));
  };
  const click = async (text) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent.includes(text));
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  const changeInput = async (input, value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const getInput = (selector) => /** @type {HTMLInputElement} */ (document.querySelector(selector));
  const getSelect = (selector) => /** @type {HTMLSelectElement} */ (document.querySelector(selector));

  beforeEach(() => {
    calendar.events = [];
    dnd.handlers = null;
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

  it('uses the full native day calendar without an empty Google column', async () => {
    await render();
    expect(container.querySelector('[aria-label="Google events"]')).toBeNull();
    expect(container.querySelector('.grid-cols-\\[52px_1fr_1fr\\]')).toBeNull();
    expect(container.querySelector('[data-slot-timestamp]').parentElement.parentElement.className).toContain('grid-cols-[52px_1fr]');
    expect(container.textContent).toContain('Your calendar works without connecting Google');
  });

  it.each([
    { id: 'action-1', key: 'action-1', type: 'action', label: 'Write a chapter, Open notes' },
    { id: 'habit-1', key: 'habit-1', type: 'habit', label: 'Read' },
  ])('drags $type from the side list without Google authorization', async (item) => {
    await render({ items: [item] });
    const tray = container.querySelector('[aria-label="Unscheduled items"]');
    expect(tray.textContent).toContain(item.label);
    expect(tray.querySelector(`[data-scheduler-drag-key="${item.key}"]`)).not.toBeNull();
    const dragged = { data: { current: { item } } };
    await act(async () => dnd.handlers.onDragStart({ active: dragged }));
    await act(async () => dnd.handlers.onDragEnd({
      active: dragged, over: { data: { current: { timestamp: '2026-10-07T10:15:00.000Z' } } },
    }));
    expect(update).toHaveBeenCalledWith(item.key, {
      starts_at: '2026-10-07T10:15:00.000Z', ends_at: '2026-10-07T10:45:00.000Z',
    });
    await render({ items: [item], blocks: [{
      source_key: item.key, starts_at: '2026-10-07T10:15:00Z', ends_at: '2026-10-07T10:45:00Z',
    }] });
    expect(container.querySelector(`[data-schedule-key="${item.key}"]`).textContent).toContain(item.label);
    expect(container.querySelector('[aria-label="Unscheduled items"]').textContent).not.toContain(item.label);
  });

  it('lays out imported busy events beside overlapping local blocks in the same day grid', async () => {
    calendar.events = [{ id: 'meeting', title: 'Team meeting', start: '2026-10-07T09:00:00Z', end: '2026-10-07T10:00:00Z' }];
    await render({ blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T09:15:00Z', ends_at: '2026-10-07T09:45:00Z' }] });
    const local = container.querySelector('[data-schedule-key="action-1"]');
    const google = container.querySelector('[aria-label="Google events"]');
    expect(local.parentElement.parentElement).toBe(google.parentElement);
    expect(local.style.width).toBe('50%');
    expect(google.firstElementChild.style.width).toBe('50%');
    expect(local.style.left).not.toBe(google.firstElementChild.style.left);
    expect(google.textContent).toContain('Google · read-only');
    expect(google.querySelector('[data-scheduler-drag-key]')).toBeNull();
  });

  it('keeps short imported event details focusable and scrollable without making them draggable', async () => {
    calendar.events = [{ id: 'brief', title: 'A detailed meeting title that needs more space', start: '2026-10-07T09:00:00Z', end: '2026-10-07T09:15:00Z' }];
    await render();
    const event = container.querySelector('[aria-label="Google events"]').firstElementChild;
    expect(event.tabIndex).toBe(0);
    expect(event.className).toContain('pointer-events-auto');
    expect(event.style.overflow).toBe('auto');
    expect(event.title).toContain('A detailed meeting title that needs more space · 09:00–09:15 · Google · read-only');
    expect(event.querySelector('[data-scheduler-drag-key]')).toBeNull();
  });

  it('tap editing opens a labeled focus-trapped dialog and saves a 30-minute estimate', async () => {
    await render();
    await click('Write a chapter');
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Duration estimate (minutes)');
    expect(getInput('[role="dialog"] input[type="time"]').step).toBe('900');
    await act(async () => dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-10-07T09:00:00.000Z', ends_at: '2026-10-07T09:30:00.000Z' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('requires explicit confirmation before saving an overlap', async () => {
    await render({ blocks: [{ source_key: 'habit-1', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }] });
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Keep this overlap intentionally');
    expect(Array.from(document.querySelectorAll('button')).find((node) => node.textContent === 'Save time').disabled).toBe(true);
    await act(async () => document.querySelector('[role="dialog"] input[type="checkbox"]').click());
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('offers earlier/later choices for a repeated DST time', async () => {
    await render({ localDate: '2026-11-01', timezone: 'America/New_York', blocks: [{ source_key: 'action-1', starts_at: '2026-11-01T05:30:00Z', ends_at: '2026-11-01T05:45:00Z' }] });
    await click('Write a chapter');
    const select = getSelect('[role="dialog"] select');
    expect(select).toBeTruthy();
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['earlier', 'later']);
  });

  it('requires an explicit occurrence after changing to a repeated DST wall time', async () => {
    await render({ localDate: '2026-11-01', timezone: 'America/New_York' });
    await click('Write a chapter');
    await changeInput(document.querySelector('[role="dialog"] input[type="time"]'), '01:30');
    const select = getSelect('[role="dialog"] select');
    expect(select.value).toBe('');
    expect(Array.from(document.querySelectorAll('button')).find((node) => node.textContent === 'Save time').disabled).toBe(true);
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).not.toHaveBeenCalled();
    await act(async () => { select.value = 'later'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-11-01T06:30:00.000Z', ends_at: '2026-11-01T07:00:00.000Z' });
  });

  it('explains a nonexistent DST start time and preserves elapsed duration across the gap', async () => {
    await render({ localDate: '2026-03-08', timezone: 'America/New_York', blocks: [{ source_key: 'action-1', starts_at: '2026-03-08T06:45:00Z', ends_at: '2026-03-08T07:15:00Z' }] });
    await click('Write a chapter');
    expect(getInput('[role="dialog"] input[type="number"]').value).toBe('30');
    await changeInput(document.querySelector('[role="dialog"] input[type="time"]'), '02:30');
    expect(document.querySelector('[role="alert"]').textContent).toContain('Choose a time before or after the clock change');
    await changeInput(document.querySelector('[role="dialog"] input[type="time"]'), '01:45');
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-03-08T06:45:00.000Z', ends_at: '2026-03-08T07:15:00.000Z' });
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
    expect(getSelect('[role="dialog"] select').value).toBe('later');
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
    expect(Array.from(document.querySelectorAll('button')).find((node) => node.textContent === 'Save time').disabled).toBe(false);
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
    expect(container.textContent).toContain('Schedule pending sync — reconnect to save.');
    expect(container.textContent).not.toContain('Schedule saved on this device');
  });

  it.each(['readOnly', 'completionSaving', 'available'])('cancels an open editor and rejects its late submit when %s locks scheduling', async (property) => {
    await render();
    await click('Write a chapter');
    const form = document.querySelector('[role="dialog"] form');
    await render({ [property]: property === 'available' ? false : true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).not.toHaveBeenCalled();
    if (property !== 'available') {
      expect(container.querySelector('[data-scheduler-edit-key="action-1"]').disabled).toBe(true);
      expect(container.querySelector('[data-scheduler-drag-key]')).toBeNull();
    }
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('rejects a late drag after a completion lock, including after it is released', async () => {
    await render();
    const dragged = { data: { current: { item: items[0] } } };
    const over = { data: { current: { timestamp: '2026-10-07T09:00:00.000Z' } } };
    const lateDrop = dnd.handlers.onDragEnd;
    await act(async () => dnd.handlers.onDragStart({ active: dragged }));
    await render({ completionSaving: true });
    await act(async () => lateDrop({ active: dragged, over }));
    await render();
    await act(async () => dnd.handlers.onDragEnd({ active: dragged, over }));
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(['day change', 'completion lock'])('isolates in-flight write state after a %s', async (change) => {
    let finishOld;
    let failNew;
    update.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failNew = reject; }));
    await render();
    await click('Write a chapter');
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Saving…');
    const nextProps = change === 'day change' ? { localDate: '2026-10-08' } : {};
    if (change === 'completion lock') await render({ completionSaving: true });
    await render(nextProps);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-scheduler-edit-key="action-1"]').disabled).toBe(false);
    await click('Write a chapter');
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => finishOld());
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Saving…');
    expect(Array.from(document.querySelectorAll('button')).find((node) => node.textContent === 'Saving…').disabled).toBe(true);
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => failNew(new Error('New-context write failed')));
    expect(document.querySelector('[role="dialog"]').textContent).toContain('New-context write failed');
    expect(Array.from(document.querySelectorAll('button')).find((node) => node.textContent === 'Save time').disabled).toBe(false);
  });

  it('preserves the exact elapsed duration when dragging a midnight block', async () => {
    await render({ blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' }] });
    const dragged = { data: { current: { item: items[0] } } };
    await act(async () => dnd.handlers.onDragStart({ active: dragged }));
    await act(async () => dnd.handlers.onDragEnd({ active: dragged, over: { data: { current: { timestamp: '2026-10-07T23:30:00.000Z' } } } }));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-10-07T23:30:00.000Z', ends_at: '2026-10-08T00:00:00.000Z' });
  });

  it('restores tap focus even when touch activation did not focus the trigger', async () => {
    await render();
    const trigger = container.querySelector('[data-scheduler-edit-key="action-1"]');
    expect(document.activeElement).not.toBe(trigger);
    await act(async () => trigger.click());
    expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);
    await click('Cancel');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps touch scrolling off only the long-press drag handle and supports Escape focus return', async () => {
    await render();
    const handle = container.querySelector('[data-scheduler-drag-key="action-1"]');
    const trigger = container.querySelector('[data-scheduler-edit-key="action-1"]');
    expect(handle.style.touchAction).toBe('none');
    expect(trigger.style.touchAction).not.toBe('none');
    expect(dnd.handlers.sensors.find(({ sensor }) => sensor.name === 'TouchSensor').options.activationConstraint).toEqual({ delay: 300, tolerance: 8 });
    handle.focus();
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(handle);
  });

  it('renders carryover supplied in loaded blocks read-only without suppressing the new day habit', async () => {
    await render({ blocks: [
      { id: 'old-habit', source_key: 'habit-1', target_local_date: '2026-10-06', label: 'Read yesterday', starts_at: '2026-10-06T23:45:00Z', ends_at: '2026-10-07T00:15:00Z' },
      { source_key: 'action-1', starts_at: '2026-10-08T09:00:00Z', ends_at: '2026-10-08T09:30:00Z' },
    ] });
    const old = container.querySelector('[data-context-schedule-id="old-habit"]');
    expect(old.querySelector('button')).toBeNull();
    expect(old.textContent).toContain('Continued from previous day');
    expect(old.style.top).toBe('0px');
    expect(old.style.height).toBe('36px');
    expect(container.textContent).toContain('Unscheduled (2)');
    expect(container.querySelector('[data-schedule-key="action-1"]')).toBeNull();
  });

  it('does not exclude carryover of the same habit identity from overlap checks', async () => {
    await render({ blocks: [
      { id: 'old-habit', source_key: 'habit-1', target_local_date: '2026-10-06', starts_at: '2026-10-06T23:45:00Z', ends_at: '2026-10-07T00:30:00Z' },
      { id: 'new-habit', source_key: 'habit-1', target_local_date: '2026-10-07', starts_at: '2026-10-07T00:15:00Z', ends_at: '2026-10-07T00:45:00Z' },
    ] });
    await click('Read');
    expect(getInput('[role="dialog"] input[type="time"]').value).toBe('00:15');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('filters out-of-day Google blocks and clips its carryover without widening lanes', async () => {
    calendar.events = [
      { id: 'old', title: 'Past meeting', start: '2026-10-06T22:00:00Z', end: '2026-10-07T00:00:00Z' },
      { id: 'carry', title: 'Night shift', start: '2026-10-06T23:30:00Z', end: '2026-10-07T00:30:00Z' },
      { id: 'future', title: 'Next meeting', start: '2026-10-08T00:00:00Z', end: '2026-10-08T01:00:00Z' },
      { id: 'all-day-past', title: 'Past holiday', start: '2026-10-06', end: '2026-10-07', allDay: true },
    ];
    await render();
    const google = container.querySelector('[aria-label="Google events"]');
    expect(google.textContent).toContain('Night shift');
    expect(google.textContent).not.toContain('Past meeting');
    expect(google.textContent).not.toContain('Next meeting');
    expect(google.firstElementChild.style.height).toBe('72px');
    expect(google.firstElementChild.style.width).toBe('100%');
    expect(container.textContent).not.toContain('Past holiday');
  });

  it('only blocks an overnight proposal for the actual all-day Google date interval', async () => {
    calendar.events = [{ id: 'all-day', title: 'Away today', start: '2026-10-07', end: '2026-10-08', allDay: true }];
    await render({ blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' }] });
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeTruthy();
    await click('Cancel');
    calendar.events = [{ id: 'all-day', title: 'Away yesterday', start: '2026-10-06', end: '2026-10-07', allDay: true }];
    await render();
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeNull();
    await click('Cancel');
    calendar.events = [{ id: 'all-day', title: 'Away tomorrow', start: '2026-10-08', end: '2026-10-09', allDay: true }];
    await render({ blocks: [{ source_key: 'action-1', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' }] });
    expect(container.textContent).not.toContain('Away tomorrow');
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeTruthy();
  });

  it('detects next-day Google overlap for an overnight proposal but allows touching boundaries', async () => {
    calendar.events = [{ id: 'next', title: 'Next-day call', start: '2026-10-08T00:00:00Z', end: '2026-10-08T00:30:00Z' }];
    const blocks = [{ source_key: 'action-1', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' }];
    await render({ blocks });
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeTruthy();
    await click('Cancel');
    calendar.events = [{ id: 'next', title: 'Next-day call', start: '2026-10-08T00:15:00Z', end: '2026-10-08T00:30:00Z' }];
    await render({ blocks });
    await click('Write a chapter');
    expect(document.querySelector('[role="dialog"] input[type="checkbox"]')).toBeNull();
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
    expect(getInput('[role="dialog"] input[type="number"]').value).toBe('30');
  });

  it('labels a 24-elapsed-hour spring-forward block +2 days and clips its second-date carryover', async () => {
    const block = { id: 'long-dst-block', source_key: 'action-1', target_local_date: '2026-03-07', label: 'Write a chapter', starts_at: '2026-03-08T04:45:00Z', ends_at: '2026-03-09T04:45:00Z' };
    await render({ localDate: '2026-03-07', timezone: 'America/New_York', blocks: [block] });
    expect(container.textContent).toContain('(+2 days)');
    expect(container.textContent).not.toContain('(+1 day)');
    await click('Write a chapter');
    expect(getInput('[role="dialog"] input[type="number"]').value).toBe('1440');
    await act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith('action-1', { starts_at: '2026-03-08T04:45:00.000Z', ends_at: '2026-03-09T04:45:00.000Z' });
    await render({ localDate: '2026-03-09', timezone: 'America/New_York', blocks: [block] });
    const context = container.querySelector('[data-context-schedule-id="long-dst-block"]');
    expect(context.textContent).toContain('(+2 days)');
    expect(context.textContent).toContain('Previous-day · 2026-03-07 · read-only');
    expect(context.style.height).toBe('108px');
    expect(context.style.top).toBe('0px');
    expect(context.querySelector('button')).toBeNull();
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
