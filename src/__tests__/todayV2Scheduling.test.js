import { describe, expect, it } from 'vitest';
import {
  createActionIdentity, reconcileActionIdentities, zonedLocalTimeToTimestamp,
  clipScheduleBlocksToDate, getScheduleDateBounds, getScheduleDayOffset, getScheduleLocalDate, normalizeScheduleBlock, resizeScheduleBlock, scheduleBlocksOverlap, layoutScheduleBlocks, snapScheduleMinutes,
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
  it('explains how to recover from an unsupported timezone', () => {
    expect(() => zonedLocalTimeToTimestamp('2026-10-07', '09:00', 'Unsupported/Nowhere')).toThrow(/Choose a valid IANA timezone/);
  });
  it('derives the civil date in the saved timezone rather than the machine timezone', () => {
    const now = new Date('2026-10-08T03:00:00Z');
    expect(getScheduleLocalDate(now, 'UTC')).toBe('2026-10-08');
    expect(getScheduleLocalDate(now, 'America/New_York')).toBe('2026-10-07');
  });
  it('clips half-open day intersections without changing stored elapsed duration', () => {
    const bounds = getScheduleDateBounds('2026-10-07', 'UTC');
    const blocks = [
      { id: 'carryover', starts_at: '2026-10-06T23:45:00Z', ends_at: '2026-10-07T00:15:00Z' },
      { id: 'overnight', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' },
      { id: 'past', starts_at: '2026-10-06T23:00:00Z', ends_at: bounds.starts_at },
      { id: 'future', starts_at: bounds.ends_at, ends_at: '2026-10-08T01:00:00Z' },
      { id: 'invalid', starts_at: 'invalid', ends_at: bounds.ends_at },
      { id: 'empty', starts_at: bounds.starts_at, ends_at: bounds.starts_at },
    ];
    const visible = clipScheduleBlocksToDate(blocks, bounds);
    expect(visible.map((block) => block.id)).toEqual(['carryover', 'overnight']);
    expect(visible[0]).toMatchObject({ ...blocks[0], visible_starts_at: bounds.starts_at, continued: true, continues: false });
    expect(visible[1]).toMatchObject({ ...blocks[1], visible_ends_at: bounds.ends_at, continued: false, continues: true });
    expect((Date.parse(visible[1].ends_at) - Date.parse(visible[1].starts_at)) / 60000).toBe(30);
    expect(blocks[0].visible_starts_at).toBeUndefined();
  });
  it('counts actual civil dates when 24 elapsed hours cross a spring-forward midnight', () => {
    const starts_at = zonedLocalTimeToTimestamp('2026-03-07', '23:45', 'America/New_York');
    const ends_at = new Date(Date.parse(starts_at) + 1440 * 60000).toISOString();
    expect(ends_at).toBe('2026-03-09T04:45:00.000Z');
    expect(getScheduleDayOffset(starts_at, ends_at, 'America/New_York')).toBe(2);
    const carryover = clipScheduleBlocksToDate([{ starts_at, ends_at }], getScheduleDateBounds('2026-03-09', 'America/New_York'))[0];
    expect(carryover).toMatchObject({ continued: true, continues: false, visible_starts_at: '2026-03-09T04:00:00.000Z', visible_ends_at: ends_at });
  });
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
  it('uses the first real instant when a timezone skips local midnight', () => {
    const bounds = getScheduleDateBounds('2026-09-06', 'America/Santiago');
    expect(bounds).toEqual({
      starts_at: '2026-09-06T04:00:00.000Z',
      ends_at: '2026-09-07T03:00:00.000Z',
    });
    expect(() => zonedLocalTimeToTimestamp('2026-09-06', '00:30', 'America/Santiago')).toThrow(/gap/);
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
  it.each([
    ['2026-03-08', '2026-03-08T06:45:00Z', '2026-03-08T07:00:00Z', '2026-03-08T07:30:00.000Z'],
    ['2026-11-01', '2026-11-01T05:45:00Z', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00.000Z'],
    ['2026-10-07', '2026-10-08T03:30:00Z', '2026-10-08T03:45:00Z', '2026-10-08T04:15:00.000Z'],
  ])('resizes through DST or midnight using elapsed timeline minutes on %s', (date, starts_at, ends_at, expectedEnd) => {
    const bounds = getScheduleDateBounds(date, 'America/New_York');
    expect(resizeScheduleBlock({ starts_at, ends_at }, 'end', 30, bounds)).toEqual({
      starts_at: new Date(starts_at).toISOString(), ends_at: expectedEnd,
    });
  });
  it('clamps start to the owning day and duration to the local persistence limit', () => {
    const bounds = getScheduleDateBounds('2026-10-07', 'UTC');
    const block = { starts_at: '2026-10-07T00:15:00Z', ends_at: '2026-10-07T01:00:00Z' };
    expect(resizeScheduleBlock(block, 'start', -60, bounds).starts_at).toBe(bounds.starts_at);
    expect(resizeScheduleBlock(block, 'end', 2000, bounds).ends_at).toBe('2026-10-08T00:15:00.000Z');
    expect(() => resizeScheduleBlock(block, 'invalid', 0, bounds)).toThrow('Invalid resize');
  });
});
