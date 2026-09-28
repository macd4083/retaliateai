import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('../lib/supabase/client', () => ({
  supabase: supabaseMock,
}));

import {
  buildEmptyHabitDefinition,
  loadTodayReviewState,
  replaceTomorrowActions,
  seedDefaultHabits,
} from '../v2/services/todayReview';
import {
  TODAY_V2_FORBIDDEN_PERSISTENCE_TOKENS,
  TODAY_V2_RPCS,
  TODAY_V2_TABLES,
} from '../v2/today/types';

function createThenableBuilder(result, tracker = {}) {
  return {
    tracker,
    select(selection) {
      tracker.selection = selection;
      return this;
    },
    upsert(payload, options) {
      tracker.upsert = { payload, options };
      return this;
    },
    insert(payload) {
      tracker.insert = payload;
      return this;
    },
    update(payload) {
      tracker.update = payload;
      return this;
    },
    eq(column, value) {
      tracker.eq = [...(tracker.eq || []), [column, value]];
      return this;
    },
    order(column, options) {
      tracker.order = [...(tracker.order || []), [column, options]];
      return this;
    },
    maybeSingle() {
      tracker.maybeSingle = true;
      return Promise.resolve(result);
    },
    single() {
      tracker.single = true;
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

describe('TodayV2 repository', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a missing seed RPC as a non-blocking diagnostic', async () => {
    supabaseMock.rpc.mockResolvedValue({
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.today_v2_seed_default_habits_for_user(p_user_id) in the schema cache',
      },
    });

    await expect(seedDefaultHabits('user-1')).resolves.toEqual({
      error: expect.objectContaining({ code: 'PGRST202' }),
      diagnostic: expect.objectContaining({
        message: 'Default habit seeding is temporarily unavailable. You can still add habits manually.',
      }),
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(TODAY_V2_RPCS.SEED_DEFAULT_HABITS, { p_user_id: 'user-1' });
  });

  it('looks up commitment fragments by target local date and only queries TodayV2 tables', async () => {
    const trackers = [];

    supabaseMock.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null });

    supabaseMock.from.mockImplementation((tableName) => {
      const tracker = { tableName };
      trackers.push(tracker);

      if (tableName === TODAY_V2_TABLES.DAILY_REVIEWS) {
        return createThenableBuilder({
          data: { id: 'review-1', local_date: '2026-09-28', timezone_name: 'UTC', desired_direction: 'Builder' },
          error: null,
        }, tracker);
      }

      if (tableName === TODAY_V2_TABLES.PLAN_INPUTS) {
        return createThenableBuilder({
          data: {
            id: 'plan-1',
            raw_plan_text: 'Write 20 minutes and review notes',
            target_local_date: '2026-09-29',
          },
          error: null,
        }, tracker);
      }

      if (tableName === TODAY_V2_TABLES.HABIT_DEFINITIONS) {
        return createThenableBuilder({
          data: [],
          error: null,
        }, tracker);
      }

      if (tableName === TODAY_V2_TABLES.HABIT_OCCURRENCES) {
        return createThenableBuilder({
          data: [],
          error: null,
        }, tracker);
      }

      if (tableName === TODAY_V2_TABLES.COMMITMENT_FRAGMENTS) {
        return createThenableBuilder({
          data: [],
          error: null,
        }, tracker);
      }

      throw new Error(`Unexpected table: ${tableName}`);
    });

    const state = await loadTodayReviewState('user-1');

    expect(state.todayLocalDate).toBe('2026-09-28');
    expect(state.tomorrowLocalDate).toBe('2026-09-29');

    const commitmentTrackers = trackers.filter((tracker) => tracker.tableName === TODAY_V2_TABLES.COMMITMENT_FRAGMENTS);
    expect(commitmentTrackers).toHaveLength(2);
    expect(commitmentTrackers[0].eq).toContainEqual(['target_local_date', '2026-09-28']);
    expect(commitmentTrackers[1].eq).toContainEqual(['target_local_date', '2026-09-29']);

    for (const token of TODAY_V2_FORBIDDEN_PERSISTENCE_TOKENS) {
      expect(trackers.some((tracker) => tracker.tableName === token)).toBe(false);
    }
  });

  it('saves tomorrow plans through the isolated replace RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });

    await replaceTomorrowActions({
      targetLocalDate: '2026-09-29',
      sourceLocalDate: '2026-09-28',
      timezoneName: 'UTC',
      rawPlanText: 'Write 20 minutes and review notes',
      actionTexts: [],
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(TODAY_V2_RPCS.REPLACE_PLAN, {
      p_target_local_date: '2026-09-29',
      p_source_local_date: '2026-09-28',
      p_timezone_name: 'UTC',
      p_raw_plan_text: 'Write 20 minutes and review notes',
      p_fragment_texts: ['Write 20 minutes', 'review notes'],
    });
  });

  it('creates new habit drafts with explicit TodayV2 fields', () => {
    expect(buildEmptyHabitDefinition([{ id: 'habit-1' }, { id: 'habit-2' }])).toEqual({
      id: null,
      name: '',
      response_type: 'boolean',
      unit: '',
      schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
      display_order: 2,
    });
  });
});
