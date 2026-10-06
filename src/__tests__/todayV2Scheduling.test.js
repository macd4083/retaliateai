import { describe, expect, it } from 'vitest';
import {
  createActionIdentity, reconcileActionIdentities, zonedLocalTimeToTimestamp,
  getScheduleDateBounds, normalizeScheduleBlock, scheduleBlocksOverlap, layoutScheduleBlocks, snapScheduleMinutes,
} from '../v2/today/scheduling';

describe('scheduler identities', () => {
  it('preserves unique exact identities through reordering and removal', () => {
    const previous = ['Write', 'Walk', 'Read'].map((text) => createActionIdentity(text));
    const next = reconcileActionIdentities(previous, ['Read', 'Write']);
    expect(next.map((item) => item.key)).toEqual([previous[2].key, previous[0].key]);
  });
  it('retains a single edited row only for explicit string-list edits', () => {
    const previous = ['Write', 'Walk'].map((text) => createActionIdentity(text));
    expect(reconcileActionIdentities(previous, ['Write more', 'Walk'], { allowSingleEdit: true })[0].key).toBe(previous[0].key);
    expect(reconcileActionIdentities(previous, ['Write more', 'Walk'])[0].key).not.toBe(previous[0].key);
  });
  it('does not borrow ambiguous duplicate identities or positions during resplit', () => {
    const previous = ['Write', 'Write'].map((text) => createActionIdentity(text));
    const next = reconcileActionIdentities(previous, ['Write', 'Read']);
    expect(next.every((item) => !previous.some((old) => old.key === item.key))).toBe(true);
  });
});

describe('zoned scheduling', () => {
  it('rejects DST gaps and requires an explicit choice for repeated times', () => {
    expect(() => zonedLocalTimeToTimestamp('2026-03-08', '02:30', 'America/New_York')).toThrow(/gap/);
    expect(() => zonedLocalTimeToTimestamp('2026-11-01', '01:30', 'America/New_York')).toThrow(/Ambiguous/);
    expect(zonedLocalTimeToTimestamp('2026-11-01', '01:30', 'America/New_York', 'earlier')).toBe('2026-11-01T05:30:00.000Z');
    expect(zonedLocalTimeToTimestamp('2026-11-01', '01:30', 'America/New_York', 'later')).toBe('2026-11-01T06:30:00.000Z');
  });
  it('computes date bounds across 23-hour and 25-hour dates', () => {
    for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
      const bounds = getScheduleDateBounds(date, 'America/New_York');
      expect((Date.parse(bounds.ends_at) - Date.parse(bounds.starts_at)) / 3600000).toBe(hours);
    }
  });
  it('snaps by fifteen minutes, defaults to thirty, allows midnight crossing up to 24 hours', () => {
    expect(snapScheduleMinutes(37)).toBe(30);
    const block = normalizeScheduleBlock({ starts_at: '2026-09-29T23:45:00Z' });
    expect(block.ends_at).toBe('2026-09-30T00:15:00.000Z');
    expect(() => normalizeScheduleBlock({ starts_at: block.starts_at, ends_at: '2026-10-01T00:00:00Z' })).toThrow(/24 hours/);
  });
  it('allows touching blocks and assigns overlap lanes', () => {
    const a = normalizeScheduleBlock({ starts_at: '2026-09-29T10:00:00Z' });
    const b = normalizeScheduleBlock({ starts_at: '2026-09-29T10:15:00Z' });
    const c = normalizeScheduleBlock({ starts_at: '2026-09-29T10:30:00Z' });
    expect(scheduleBlocksOverlap(a, b)).toBe(true);
    expect(scheduleBlocksOverlap(a, c)).toBe(false);
    expect(layoutScheduleBlocks([c, b, a]).map((block) => block.lane)).toEqual([0, 1, 0]);
  });
});
