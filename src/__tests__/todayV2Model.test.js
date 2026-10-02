import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTodayV2CommitmentDrafts,
  buildTodayV2HabitResponsePatch,
  buildTodayV2HomeMetrics,
  buildTodayV2OccurrenceSnapshots,
  getLatestTodayV2Identity,
  getTodayV2BooleanAnswer,
  getTodayV2CompletionGate,
  getTodayV2DateContext,
  getTodayV2DefaultPath,
  getTodayV2MsUntilNextBoundary,
} from '../v2/today/model';
import { TODAY_V2_COMMITMENT_STATES, TODAY_V2_RESPONSE_TYPES } from '../v2/today/types';

describe('TodayV2 model helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits one paragraph into multiple ordered commitment fragments', () => {
    expect(
      buildTodayV2CommitmentDrafts('Write 20 minutes, and review notes; then send summary.')
    ).toEqual([
      expect.objectContaining({
        fragmentText: 'Write 20 minutes',
        normalizedFragmentText: 'Write 20 minutes',
        fragmentOrder: 0,
        completionState: TODAY_V2_COMMITMENT_STATES.UNANSWERED,
      }),
      expect.objectContaining({
        fragmentText: 'review notes',
        normalizedFragmentText: 'review notes',
        fragmentOrder: 1,
      }),
      expect.objectContaining({
        fragmentText: 'then send summary',
        normalizedFragmentText: 'then send summary',
        fragmentOrder: 2,
      }),
    ]);
  });

  it('builds only scheduled non-archived habit occurrences for a date', () => {
    expect(
      buildTodayV2OccurrenceSnapshots(
        [
          {
            id: 'habit-1',
            name: 'Sleep',
            response_type: TODAY_V2_RESPONSE_TYPES.NUMBER,
            unit: 'hours',
            schedule_weekdays: [1],
            display_order: 1,
            is_archived: false,
          },
          {
            id: 'habit-2',
            name: 'Exercise',
            response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN,
            unit: null,
            schedule_weekdays: [1],
            display_order: 0,
            is_archived: true,
          },
          {
            id: 'habit-3',
            name: 'Focused work',
            response_type: TODAY_V2_RESPONSE_TYPES.NUMBER,
            unit: 'minutes',
            schedule_weekdays: [2],
            display_order: 2,
            is_archived: false,
          },
        ],
        '2026-09-28',
        'UTC'
      )
    ).toEqual([
      expect.objectContaining({
        habit_definition_id: 'habit-1',
        snapshot_name: 'Sleep',
        scheduled_weekday: 1,
        snapshot_response_type: TODAY_V2_RESPONSE_TYPES.NUMBER,
      }),
    ]);
  });

  it('distinguishes unanswered from explicit false boolean habit responses', () => {
    const unanswered = buildTodayV2HabitResponsePatch(TODAY_V2_RESPONSE_TYPES.BOOLEAN, null);
    const explicitFalse = buildTodayV2HabitResponsePatch(TODAY_V2_RESPONSE_TYPES.BOOLEAN, false);

    expect(unanswered).toEqual({
      boolean_response: null,
      numeric_response: null,
      answered_at: null,
    });
    expect(explicitFalse.boolean_response).toBe(false);
    expect(explicitFalse.numeric_response).toBeNull();
    expect(explicitFalse.answered_at).toEqual(expect.any(String));
    expect(getTodayV2BooleanAnswer(null, null)).toBe(TODAY_V2_COMMITMENT_STATES.UNANSWERED);
    expect(getTodayV2BooleanAnswer(false, explicitFalse.answered_at)).toBe('no');
  });

  it('keeps the review on the previous day before the configured boundary hour', () => {
    const context = getTodayV2DateContext({
      now: new Date('2026-09-29T03:30:00.000Z'),
      dayBoundaryHour: 4,
      timezoneName: 'UTC',
    });

    expect(context).toEqual(expect.objectContaining({
      timezoneName: 'UTC',
      dayBoundaryHour: 4,
      todayLocalDate: '2026-09-28',
      tomorrowLocalDate: '2026-09-29',
      yesterdayLocalDate: '2026-09-27',
    }));
  });

  it('computes the next boundary timeout from the configured hour', () => {
    const now = new Date('2026-09-29T03:59:30.000Z');
    expect(getTodayV2MsUntilNextBoundary({ now, dayBoundaryHour: 4 })).toBe(30_000);
  });

  it('summarizes completion gating with habits as a soft warning only', () => {
    expect(getTodayV2CompletionGate({
      followThroughItems: [
        { completion_state: TODAY_V2_COMMITMENT_STATES.KEPT },
        { completion_state: TODAY_V2_COMMITMENT_STATES.NOT_KEPT },
      ],
      habitOccurrences: [
        { snapshot_response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN, boolean_response: null, answered_at: null },
      ],
      tomorrowActions: ['Write 20 minutes'],
    })).toEqual({
      canComplete: true,
      followThroughSatisfied: true,
      unansweredHabitsCount: 1,
      hasSoftHabitWarning: true,
      hasTomorrowActions: true,
    });
  });

  it('builds proof-screen metrics from V2 review data only', () => {
    const metrics = buildTodayV2HomeMetrics({
      todayLocalDate: '2026-09-29',
      reviews: [
        { local_date: '2026-09-29', completed_at: null, desired_direction: 'Builder' },
        { local_date: '2026-09-28', completed_at: '2026-09-29T02:00:00.000Z', desired_direction: 'Builder' },
        { local_date: '2026-09-27', completed_at: '2026-09-28T02:00:00.000Z', desired_direction: 'Focused builder' },
        { local_date: '2026-09-25', completed_at: '2026-09-26T02:00:00.000Z', desired_direction: '' },
      ],
      fragments: [
        { target_local_date: '2026-09-29', completion_state: TODAY_V2_COMMITMENT_STATES.KEPT },
        { target_local_date: '2026-09-29', completion_state: TODAY_V2_COMMITMENT_STATES.NOT_KEPT },
        { target_local_date: '2026-09-28', completion_state: TODAY_V2_COMMITMENT_STATES.KEPT },
        { target_local_date: '2026-09-27', completion_state: TODAY_V2_COMMITMENT_STATES.UNANSWERED },
      ],
      habitOccurrences: [
        { snapshot_name: 'Exercise/movement', snapshot_response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN, snapshot_unit: null, boolean_response: true, answered_at: '2026-09-29T12:00:00.000Z' },
        { snapshot_name: 'Exercise/movement', snapshot_response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN, snapshot_unit: null, boolean_response: false, answered_at: '2026-09-28T12:00:00.000Z' },
        { snapshot_name: 'Focused work', snapshot_response_type: TODAY_V2_RESPONSE_TYPES.NUMBER, snapshot_unit: 'minutes', numeric_response: 45, answered_at: '2026-09-29T12:00:00.000Z' },
        { snapshot_name: 'Focused work', snapshot_response_type: TODAY_V2_RESPONSE_TYPES.NUMBER, snapshot_unit: 'minutes', numeric_response: null, answered_at: null },
      ],
    });

    expect(metrics.reviewStreak).toBe(2);
    expect(metrics.sevenDayCommitmentRate).toEqual({ kept: 2, answered: 3, rate: 2 / 3 });
    expect(metrics.sevenDayDots.map((dot) => dot.completed)).toEqual([false, false, true, false, true, true, false]);
    expect(metrics.perHabitRates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Exercise/movement', kept: 1, answered: 2, rate: 0.5 }),
      expect.objectContaining({ name: 'Focused work', answered: 1, scheduled: 2, rate: 0.5 }),
    ]));
    expect(getLatestTodayV2Identity([
      { local_date: '2026-09-28', desired_direction: 'Builder' },
      { local_date: '2026-09-27', desired_direction: 'Focused builder' },
    ])).toBe('Builder');
    expect(getTodayV2DefaultPath({ completed_at: '2026-09-29T02:00:00.000Z' })).toBe('/home');
  });
});
