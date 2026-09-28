import { describe, expect, it } from 'vitest';

import {
  buildTodayV2CommitmentDrafts,
  buildTodayV2HabitResponsePatch,
  buildTodayV2OccurrenceSnapshots,
  getTodayV2BooleanAnswer,
} from '../v2/today/model';
import { TODAY_V2_COMMITMENT_STATES, TODAY_V2_RESPONSE_TYPES } from '../v2/today/types';

describe('TodayV2 model helpers', () => {
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
});
