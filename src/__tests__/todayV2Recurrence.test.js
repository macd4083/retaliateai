import { describe, expect, it } from 'vitest';
import { getHabitScheduleForDate, normalizeHabitRecurrence } from '../v2/today/recurrence';
import { getTodayV2DateContext, reconcileTodayV2InputActions } from '../v2/today/model';

const createIdentity = (text) => ({ key: crypto.randomUUID(), text, persistedId: null });

describe('habit recurrence contract', () => {
  it('uses the prescribed timezone for civil dates and the review boundary', () => {
    expect(getTodayV2DateContext({
      now: new Date('2026-09-29T06:30:00Z'), timezoneName: 'America/New_York', dayBoundaryHour: 4,
    }).todayLocalDate).toBe('2026-09-28');
    expect(getTodayV2DateContext({
      now: new Date('2026-09-29T06:30:00Z'), timezoneName: 'Asia/Tokyo', dayBoundaryHour: 4,
    }).todayLocalDate).toBe('2026-09-29');
  });
  it('defaults to manual and supports precise weekday preferences', () => {
    expect(normalizeHabitRecurrence({})).toEqual({ planning_mode: 'manual', schedule_times: {} });
    const habit = { schedule_weekdays: [2], schedule_times: {
      2: { time: '23:59', duration_minutes: 1440, occurrence: 'earlier' },
    } };
    expect(normalizeHabitRecurrence(habit).schedule_times[2].time).toBe('23:59');
    expect(getHabitScheduleForDate(habit, '2026-09-29')).toEqual(habit.schedule_times[2]);
    expect(getHabitScheduleForDate(habit, '2026-09-30')).toBeNull();
  });

  it.each([
    { time: '24:00', duration_minutes: 30, occurrence: 'earlier' },
    { time: '10:01', duration_minutes: 0, occurrence: 'earlier' },
    { time: '10:01', duration_minutes: 30.5, occurrence: 'earlier' },
    { time: '10:01', duration_minutes: 1441, occurrence: 'earlier' },
    { time: '10:01', duration_minutes: 30, occurrence: 'unknown' },
  ])('rejects malformed weekday settings %j', (entry) => {
    expect(() => normalizeHabitRecurrence({ schedule_times: { 2: entry } })).toThrow();
  });

  it('requires every selected automatic day, but permits optional manual times', () => {
    expect(() => normalizeHabitRecurrence({ planning_mode: 'automatic', schedule_weekdays: [1, 2] }))
      .toThrow(/every selected/);
    expect(() => normalizeHabitRecurrence({ planning_mode: 'manual', schedule_weekdays: [1, 2] })).not.toThrow();
  });
});

describe('live input reconciliation', () => {
  it('keeps explicit edits and deleted rows while immediately appending new input', () => {
    const edited = { key: 'write', persistedId: 'persisted-write', text: 'Write a chapter', inputText: 'Write', explicitEdit: true };
    const next = reconcileTodayV2InputActions('Write and Walk', 'Write and Walk and Read', [edited], createIdentity);
    expect(next.map((item) => item.text)).toEqual(['Write a chapter', 'Read']);
    expect(next[0]).toMatchObject({ key: 'write', persistedId: 'persisted-write' });
  });

  it('recovers old edited persisted plans without gating new automatic fragments', () => {
    const existing = [{ key: 'write', text: 'Write a chapter', persistedId: 'write-id' }, { key: 'walk', text: 'Walk', persistedId: 'walk-id' }];
    const next = reconcileTodayV2InputActions('Write and Walk', 'Write and Walk and Read', existing, createIdentity);
    expect(next.map((item) => item.text)).toEqual(['Write a chapter', 'Walk', 'Read']);
    expect(next.slice(0, 2).map((item) => item.persistedId)).toEqual(['write-id', 'walk-id']);
  });

  it('retains typing identities but never transfers a block to unrelated replacement text', () => {
    const existing = [{ key: 'write', text: 'Write', inputText: 'Write', persistedId: 'write-id' }];
    expect(reconcileTodayV2InputActions('Write', 'Write more', existing, createIdentity)[0].key).toBe('write');
    expect(reconcileTodayV2InputActions('Write', 'Read', existing, createIdentity)[0].key).not.toBe('write');
  });
});
