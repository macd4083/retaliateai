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
  setFollowThroughCompletion,
  seedDefaultHabits,
  updateControllableFocus,
  upsertHabitDefinition,
  ensureTodayV2AutomaticHabitSchedules,
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
      planning_mode: 'manual',
      schedule_times: {},
      display_order: 2,
    });
  });

  it('persists validated recurrence settings with owned habit updates', async () => {
      const tracker = {};
      supabaseMock.from.mockImplementation(() => createThenableBuilder({ error: null }, tracker));
      await upsertHabitDefinition('user-1', {
        id: 'habit-1', name: 'Read', response_type: 'boolean', schedule_weekdays: [2],
        planning_mode: 'automatic',
        schedule_times: { 2: { time: '09:07', duration_minutes: 43, occurrence: 'later' } },
      });
      expect(tracker.update).toMatchObject({
        user_id: 'user-1', planning_mode: 'automatic',
        schedule_times: { 2: { time: '09:07', duration_minutes: 43, occurrence: 'later' } },
      });
      expect(tracker.eq).toContainEqual(['user_id', 'user-1']);
      await expect(upsertHabitDefinition('user-1', {
        name: 'Read', schedule_weekdays: [2], planning_mode: 'automatic', schedule_times: {},
      })).rejects.toThrow(/every selected/);
    });

  it('requests authorized server recurrence seeding and tolerates an undeployed RPC', async () => {
      supabaseMock.rpc.mockResolvedValueOnce({ error: null });
      await ensureTodayV2AutomaticHabitSchedules('2026-09-28', '2026-09-29', 'America/New_York');
      expect(supabaseMock.rpc).toHaveBeenCalledWith('today_v2_seed_habit_schedules', {
        p_start_local_date: '2026-09-28', p_end_local_date: '2026-09-29', p_timezone_name: 'America/New_York',
      });
      supabaseMock.rpc.mockResolvedValueOnce({ error: { code: 'PGRST202' } });
      await expect(ensureTodayV2AutomaticHabitSchedules('2026-09-28', '2026-09-29', 'UTC'))
        .resolves.toMatchObject({ code: 'PGRST202' });
  });

  it('loads the legacy workflow when recurrence columns are undeployed and reports a migration diagnostic', async () => {
    const definitions = [{ id: 'habit-1', name: 'Read', schedule_weekdays: [2], is_archived: false }];
    let definitionReads = 0;
    supabaseMock.rpc.mockResolvedValue({ error: null });
    supabaseMock.from.mockImplementation((table) => {
      if (table === TODAY_V2_TABLES.HABIT_DEFINITIONS) {
        definitionReads += 1;
        return createThenableBuilder(definitionReads === 1
          ? { error: { code: 'PGRST204', message: 'Missing planning_mode column' } }
          : { data: definitions, error: null });
      }
      return createThenableBuilder({
        data: table === TODAY_V2_TABLES.DAILY_REVIEWS
          ? { id: 'review-1', local_date: '2026-09-28', desired_direction: '', completed_at: null }
          : [],
        error: null,
      });
    });
    const loaded = await loadTodayReviewState('user-1', { timezoneName: 'UTC' });
    expect(loaded.habitDefinitions).toEqual(definitions);
    expect(loaded.recurrenceDiagnostic).toMatchObject({ code: 'HABIT_RECURRENCE_SCHEMA_MISSING' });
    expect(definitionReads).toBe(2);
    expect(supabaseMock.rpc.mock.calls.some(([rpc]) => rpc === 'today_v2_seed_habit_schedules')).toBe(false);
  });

  it.each([null, 'habit-1'])('saves legacy manual habits without recurrence columns (id %s)', async (id) => {
    const trackers = [];
    supabaseMock.from.mockImplementation(() => {
      const tracker = {};
      trackers.push(tracker);
      return createThenableBuilder(trackers.length === 1
        ? { error: { code: 'PGRST204', message: 'Missing schedule_times column' } }
        : { data: { id: 'habit-1' }, error: null }, tracker);
    });
    await expect(upsertHabitDefinition('user-1', {
      id, name: 'Read', response_type: 'boolean', schedule_weekdays: [2], planning_mode: 'manual', schedule_times: {},
    })).resolves.toBe('habit-1');
    const legacy = trackers[1][id ? 'update' : 'insert'];
    expect(legacy).toMatchObject({ user_id: 'user-1', name: 'Read', schedule_weekdays: [2] });
    expect(legacy).not.toHaveProperty('planning_mode');
    expect(legacy).not.toHaveProperty('schedule_times');
  });

  it.each(['manual', 'automatic'])('never silently drops configured %s recurrence on an old installation', async (planning_mode) => {
    supabaseMock.from.mockImplementation(() => createThenableBuilder({
      error: { code: '42703', message: 'Missing schedule_times column' },
    }));
    await expect(upsertHabitDefinition('user-1', {
      id: 'habit-1', name: 'Read', response_type: 'boolean', schedule_weekdays: [2], planning_mode,
      schedule_times: { 2: { time: '09:07', duration_minutes: 43, occurrence: 'later' } },
    })).rejects.toMatchObject({
      code: 'HABIT_RECURRENCE_SCHEMA_MISSING', message: expect.stringContaining('20261010'),
    });
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
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
