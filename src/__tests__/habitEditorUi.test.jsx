import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HabitEditorModal } from '../v2/pages/TodayV2Page';

vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../v2/today/useTodayV2State', () => ({ useTodayV2State: vi.fn() }));
vi.mock('../v2/components/GoogleCalendarConnection', () => ({ default: () => null }));
vi.mock('../v2/components/TomorrowScheduler', () => ({ default: () => null }));
vi.mock('../v2/services/scheduling', () => ({ isMissingScheduleSchema: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Habit editor weekly calendar', () => {
  let root;
  let container;
  let save;
  let close;
  const base = { id: 'habit-1', name: 'Read', response_type: 'boolean', unit: '', schedule_weekdays: [1] };
  const render = async (value = base, props = {}) => {
    await act(async () => root.render(<HabitEditorModal value={value} onSave={save} onClose={close} {...props} />));
  };
  const query = (selector) => document.querySelector(selector);
  const click = async (selector) => {
    const node = query(selector);
    expect(node).toBeTruthy();
    await act(async () => node.click());
  };
  const saveButton = () => Array.from(document.querySelectorAll('button')).find((button) => /Save Habit|Saving/.test(button.textContent));
  const change = async (selector, value) => {
    const node = query(selector);
    await act(async () => {
      const prototype = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const pointer = async (node, type, clientY, button = 0) => {
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, clientY, button });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      node.dispatchEvent(event);
    });
  };
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    save = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('defaults legacy habits to manual and retains identity and response settings', async () => {
    await render();
    expect(query('[role="dialog"]')).toBeTruthy();
    expect(query('input[value="manual"]').checked).toBe(true);
    expect(document.querySelectorAll('[data-habit-timeline]')).toHaveLength(7);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(query(`button[aria-label="${day}"]`)).toBeTruthy();
    }
    expect(query('input[aria-label="Monday exact time"]').value).toBe('');
    expect(query('input[aria-label="Monday duration minutes"]').value).toBe('30');
    await act(async () => saveButton().click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'habit-1', name: 'Read', response_type: 'boolean', unit: '', planning_mode: 'manual', schedule_weekdays: [1], schedule_times: {},
    }));
  });

  it('requires automatic times and allows arbitrary minutes, full-day duration, and later occurrence', async () => {
    await render();
    await click('input[value="automatic"]');
    expect(saveButton().disabled).toBe(true);
    expect(query('[role="alert"]').textContent).toContain('Automatic planning requires a time');
    await change('[aria-label="Monday exact time"]', '09:07');
    await change('[aria-label="Monday duration minutes"]', '1440');
    await change('[aria-label="Monday repeated time occurrence"]', 'later');
    expect(saveButton().disabled).toBe(false);
    await click('button[aria-label="Tuesday"]');
    expect(saveButton().disabled).toBe(true);
    await change('[aria-label="Tuesday exact time"]', '23:59');
    await act(async () => saveButton().click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      planning_mode: 'automatic', schedule_weekdays: [1, 2],
      schedule_times: {
        1: { time: '09:07', duration_minutes: 1440, occurrence: 'later' },
        2: { time: '23:59', duration_minutes: 30, occurrence: 'earlier' },
      },
    }));
  });

  it('preserves chosen times and duration when deselecting and reselecting a day', async () => {
    await render({ ...base, planning_mode: 'automatic', schedule_times: { 1: { time: '11:13', duration_minutes: 47, occurrence: 'later' } } });
    await click('button[aria-label="Monday"]');
    expect(query('[aria-label="Monday exact time"]')).toBeNull();
    expect(saveButton().disabled).toBe(true);
    await click('button[aria-label="Monday"]');
    expect(query('[aria-label="Monday exact time"]').value).toBe('11:13');
    expect(query('[aria-label="Monday duration minutes"]').value).toBe('47');
    expect(query('[aria-label="Monday repeated time occurrence"]').value).toBe('later');
    expect(saveButton().disabled).toBe(false);
  });

  it('snaps timeline click and drag to quarter-hours without changing duration', async () => {
    await render();
    const timeline = query('[data-habit-timeline="1"]');
    timeline.getBoundingClientRect = () => ({ top: 10, height: 288 });
    await pointer(timeline, 'pointerdown', 119);
    expect(query('[aria-label="Monday exact time"]').value).toBe('09:00');
    await pointer(timeline, 'pointermove', 124);
    expect(query('[aria-label="Monday exact time"]').value).toBe('09:30');
    await pointer(timeline, 'pointerup', 124);
    await pointer(timeline, 'pointermove', 160);
    expect(query('[aria-label="Monday exact time"]').value).toBe('09:30');
    expect(query('[aria-label="Monday duration minutes"]').value).toBe('30');
    await pointer(timeline, 'pointerdown', 298);
    await pointer(timeline, 'pointerup', 298);
    expect(query('[aria-label="Monday exact time"]').value).toBe('23:45');
  });

  it('ignores unselected/disabled timelines and restores a cancelled drag', async () => {
    await render();
    const timeline = query('[data-habit-timeline="1"]');
    timeline.getBoundingClientRect = () => ({ top: 0, height: 288 });
    await pointer(timeline, 'pointerdown', 100);
    await pointer(timeline, 'pointercancel', 100);
    expect(query('[aria-label="Monday exact time"]').value).toBe('');
    const unselected = query('[data-habit-timeline="2"]');
    unselected.getBoundingClientRect = () => ({ top: 0, height: 288 });
    await pointer(unselected, 'pointerdown', 100);
    await render(base, { disabled: true });
    await pointer(timeline, 'pointerdown', 100);
    expect(query('[aria-label="Monday exact time"]').value).toBe('');
    expect(query('button[aria-label="Tuesday"]').getAttribute('aria-pressed')).toBe('false');
    expect(saveButton().disabled).toBe(true);
  });

  it.each(['0', '1441', '1.5', ''])('rejects invalid duration %s', async (duration) => {
    await render();
    await change('[aria-label="Monday exact time"]', '08:01');
    await change('[aria-label="Monday duration minutes"]', duration);
    expect(saveButton().disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps number/unit editing and displays save failures without closing', async () => {
    await render();
    const numberButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Number');
    await act(async () => numberButton.click());
    await change('[aria-label="Habit name"]', 'Run');
    await change('[aria-label="Habit unit"]', 'km');
    save.mockRejectedValueOnce(new Error('Could not persist weekly schedule.'));
    await act(async () => saveButton().click());
    expect(query('[role="alert"]').textContent).toContain('Could not persist weekly schedule.');
    expect(close).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Run', unit: 'km', response_type: 'number' }));
    expect(query('[role="alert"]')).toBeNull();
  });

  it('closes with Escape using the accessible dialog', async () => {
    await render();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('locks editing and dismissal while a save is pending', async () => {
    let resolveSave;
    save.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await render();
    await change('[aria-label="Monday exact time"]', '08:01');
    await change('[aria-label="Monday duration minutes"]', '1');
    await act(async () => saveButton().click());
    expect(saveButton().disabled).toBe(true);
    expect(query('[aria-label="Habit name"]').disabled).toBe(true);
    expect(query('[aria-label="Close habit editor"]').disabled).toBe(true);
    await act(async () => {
      saveButton().click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      schedule_times: { 1: { time: '08:01', duration_minutes: 1, occurrence: 'earlier' } },
    }));
    expect(close).not.toHaveBeenCalled();
    await act(async () => resolveSave());
    expect(saveButton().disabled).toBe(false);
  });
});
