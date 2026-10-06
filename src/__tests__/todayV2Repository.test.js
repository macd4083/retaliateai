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
  completeTodayV2Review,
  getTodayV2RouteTarget,
  loadTodayReviewState,
  reopenTodayV2Review,
  replaceTomorrowActions,
  removeUnansweredFollowThroughItem,
  setFollowThroughCompletion,
  seedDefaultHabits,
  updateControllableFocus,
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
    delete() {
      tracker.delete = true;
      return this;
    },
    is(column, value) {
      tracker.is = [...(tracker.is || []), [column, value]];
      return this;
    },
    eq(column, value) {
      tracker.eq = [...(tracker.eq || []), [column, value]];
      return this;
    },
    gte(column, value) {
      tracker.gte = [...(tracker.gte || []), [column, value]];
      return this;
    },
    lte(column, value) {
      tracker.lte = [...(tracker.lte || []), [column, value]];
      return this;
    },
    lt(column, value) {
      tracker.lt = [...(tracker.lt || []), [column, value]];
      return this;
    },
    neq(column, value) {
      tracker.neq = [...(tracker.neq || []), [column, value]];
      return this;
    },
    not(column, operator, value) {
      tracker.not = [...(tracker.not || []), [column, operator, value]];
      return this;
    },
    limit(value) {
      tracker.limit = value;
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
    supabaseMock.from.mockImplementation(() => createThenableBuilder({ data: [], error: null }));
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
          data: { id: 'review-1', local_date: '2026-09-28', timezone_name: 'UTC', desired_direction: 'Builder', controllable_focus: null, completed_at: null, updated_at: '2026-09-28T12:00:00.000Z' },
          error: null,
        }, tracker);
      }

      if (tableName === TODAY_V2_TABLES.PLAN_INPUTS) {
        return createThenableBuilder({
          data: {
            id: 'plan-1',
            raw_plan_text: 'Write 20 minutes and review notes',
            first_five_minutes: 'Open the outline',
            target_local_date: '2026-09-29',
            updated_at: '2026-09-28T12:00:00.000Z',
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
    expect(state.firstFiveMinutes).toBe('Open the outline');

    const commitmentTrackers = trackers.filter((tracker) => tracker.tableName === TODAY_V2_TABLES.COMMITMENT_FRAGMENTS);
    expect(commitmentTrackers).toHaveLength(2);
    expect(commitmentTrackers[0].eq).toContainEqual(['target_local_date', '2026-09-28']);
    expect(commitmentTrackers[1].eq).toContainEqual(['target_local_date', '2026-09-29']);
    expect(trackers.find((tracker) => tracker.tableName === TODAY_V2_TABLES.PLAN_INPUTS).selection).toContain('first_five_minutes');
    expect(trackers.find((tracker) => tracker.tableName === TODAY_V2_TABLES.DAILY_REVIEWS).selection).toContain('controllable_focus');

    for (const token of TODAY_V2_FORBIDDEN_PERSISTENCE_TOKENS) {
      expect(trackers.some((tracker) => tracker.tableName === token)).toBe(false);
    }
  });

  it('shifts the working review day until the configured boundary hour passes', async () => {
    const trackers = [];

    supabaseMock.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null });

    supabaseMock.from.mockImplementation((tableName) => {
      const tracker = { tableName };
      trackers.push(tracker);

      if (tableName === TODAY_V2_TABLES.DAILY_REVIEWS) {
        return createThenableBuilder({
          data: { id: 'review-1', local_date: '2026-09-28', timezone_name: 'UTC', desired_direction: '', completed_at: null, updated_at: '2026-09-29T03:30:00.000Z' },
          error: null,
        }, tracker);
      }

      if (tableName === TODAY_V2_TABLES.PLAN_INPUTS) {
        return createThenableBuilder({ data: null, error: null }, tracker);
      }

      return createThenableBuilder({ data: [], error: null }, tracker);
    });

    const state = await loadTodayReviewState('user-1', {
      now: new Date('2026-09-29T03:30:00.000Z'),
      dayBoundaryHour: 4,
      timezoneName: 'UTC',
    });

    expect(state.todayLocalDate).toBe('2026-09-28');
    expect(state.tomorrowLocalDate).toBe('2026-09-29');
    expect(trackers.find((tracker) => tracker.tableName === TODAY_V2_TABLES.DAILY_REVIEWS).upsert.payload.local_date).toBe('2026-09-28');
    const commitmentTrackers = trackers.filter((tracker) => tracker.tableName === TODAY_V2_TABLES.COMMITMENT_FRAGMENTS);
    expect(commitmentTrackers[0].eq).toContainEqual(['target_local_date', '2026-09-28']);
    expect(commitmentTrackers[1].eq).toContainEqual(['target_local_date', '2026-09-29']);
  });

  it('saves tomorrow plans through the isolated replace RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    const savedFragments = [
      { id: '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321', fragment_order: 0, fragment_text: 'Write 20 minutes' },
      { id: '8cfde77d-dcaa-4c7c-a409-f9ef5e70e322', fragment_order: 1, fragment_text: 'review notes' },
    ];
    const tracker = {};
    supabaseMock.from.mockImplementation(() => createThenableBuilder({ data: savedFragments, error: null }, tracker));

    const result = await replaceTomorrowActions({
      targetLocalDate: '2026-09-29',
      sourceLocalDate: '2026-09-28',
      timezoneName: 'UTC',
      rawPlanText: 'Write 20 minutes and review notes',
      actionTexts: [],
      firstFiveMinutes: 'Open the outline',
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(TODAY_V2_RPCS.REPLACE_PLAN, {
      p_target_local_date: '2026-09-29',
      p_source_local_date: '2026-09-28',
      p_timezone_name: 'UTC',
      p_raw_plan_text: 'Write 20 minutes and review notes',
      p_fragment_texts: ['Write 20 minutes', 'review notes'],
      p_first_five_minutes: 'Open the outline',
    });
    expect(result.savedFragments).toEqual(savedFragments);
    expect(supabaseMock.from).toHaveBeenCalledWith(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS);
    expect(tracker.eq).toContainEqual(['target_local_date', '2026-09-29']);
    expect(tracker.order).toContainEqual(['fragment_order', { ascending: true }]);
  });

  it('preserves explicitly edited fragment rows even when the raw paragraph is blank', async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });

    await replaceTomorrowActions({
      targetLocalDate: '2026-09-29',
      sourceLocalDate: '2026-09-28',
      timezoneName: 'UTC',
      rawPlanText: '',
      actionTexts: ['Call mentor', 'Review notes'],
      firstFiveMinutes: '',
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(TODAY_V2_RPCS.REPLACE_PLAN, {
      p_target_local_date: '2026-09-29',
      p_source_local_date: '2026-09-28',
      p_timezone_name: 'UTC',
      p_raw_plan_text: '',
      p_fragment_texts: ['Call mentor', 'Review notes'],
      p_first_five_minutes: null,
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

  it('removes only owned unanswered fragments and rejects a concurrent answer', async () => {
    const tracker = {};
    supabaseMock.from.mockReturnValue(createThenableBuilder({ data: { id: 'fragment-id' }, error: null }, tracker));
    await expect(removeUnansweredFollowThroughItem('user-1', 'fragment-id')).resolves.toBe('fragment-id');
    expect(tracker.delete).toBe(true);
    expect(tracker.eq).toContainEqual(['user_id', 'user-1']);
    expect(tracker.eq).toContainEqual(['completion_state', 'unanswered']);
    expect(tracker.is).toContainEqual(['answered_at', null]);
    supabaseMock.from.mockReturnValue(createThenableBuilder({ data: null, error: null }));
    await expect(removeUnansweredFollowThroughItem('user-1', 'fragment-id')).rejects.toThrow(/unanswered/);
  });

  it('persists completion state updates with the matching answered_at behavior', async () => {
    const tracker = {};
    supabaseMock.from.mockImplementation(() => createThenableBuilder({
      data: { id: 'fragment-1', completion_state: 'kept', answered_at: '2026-09-28T12:00:00.000Z' },
      error: null,
    }, tracker));

    await setFollowThroughCompletion('fragment-1', 'kept');

    expect(tracker.update).toEqual({
      completion_state: 'kept',
      answered_at: expect.any(String),
    });

    await setFollowThroughCompletion('fragment-1', null);

    expect(tracker.update).toEqual({
      completion_state: 'unanswered',
      answered_at: null,
    });
  });

  it('persists review completion in the isolated daily review table', async () => {
    const tracker = {};
    supabaseMock.from.mockImplementation(() => createThenableBuilder({
      data: { id: 'review-1', completed_at: '2026-09-28T22:30:00.000Z' },
      error: null,
    }, tracker));

    await completeTodayV2Review('review-1');

    expect(tracker.update).toEqual({
      completed_at: expect.any(String),
    });
  });

  it('reads and writes controllable focus and includes it in review selections', async () => {
    const trackers = [];
    supabaseMock.from.mockImplementation(() => {
      const tracker = {};
      trackers.push(tracker);
      return createThenableBuilder({
        data: { id: 'review-1', controllable_focus: 'Protect the work block' },
        error: null,
      }, tracker);
    });

    await updateControllableFocus('review-1', '  Protect the work block  ');
    expect(trackers[0].update).toEqual({ controllable_focus: 'Protect the work block' });

    await reopenTodayV2Review('review-1');
    expect(trackers[1].selection).toContain('controllable_focus');
  });

  it('routes completed reviews to /home without touching legacy tables', async () => {
    const tracker = {};
    supabaseMock.from.mockImplementation((tableName) => {
      expect(tableName).toBe(TODAY_V2_TABLES.DAILY_REVIEWS);
      return createThenableBuilder({
        data: { id: 'review-1', local_date: '2026-09-28', timezone_name: 'UTC', desired_direction: '', completed_at: '2026-09-28T22:30:00.000Z', updated_at: '2026-09-28T22:30:00.000Z' },
        error: null,
      }, tracker);
    });

    await expect(getTodayV2RouteTarget('user-1')).resolves.toBe('/home');
    expect(tracker.upsert.payload).toEqual(expect.objectContaining({
      user_id: 'user-1',
      local_date: '2026-09-28',
    }));
  });
});
