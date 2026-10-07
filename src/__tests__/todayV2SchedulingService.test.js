import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), enabled: true }));
vi.mock('../lib/supabase/client', () => ({ supabase: mocks }));
vi.mock('../lib/featureFlags', () => ({
  get ENABLE_TODAY_V2_SCHEDULER() { return mocks.enabled; },
}));
import { loadSchedules, replaceSchedule } from '../v2/services/scheduling';
import { replaceTomorrowActions, loadTodayReviewState, loadTodayV2HomeState } from '../v2/services/todayReview';

function builder(result) {
  return {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), upsert: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
}

describe('optional schedule repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.from.mockImplementation(() => builder({ data: [], error: null }));
  });
  it('loads today and tomorrow from one dataset', async () => {
    mocks.from.mockReturnValue(builder({ data: [
      { id: 'today', target_local_date: '2026-09-28', commitment_fragment_id: 'action-id' },
      { id: 'tomorrow', target_local_date: '2026-09-29', habit_definition_id: 'habit-id' },
    ], error: null }));
    const state = await loadSchedules('user', '2026-09-28', '2026-09-29');
    expect(state.todaySchedules.map((row) => row.id)).toEqual(['today']);
    expect(state.tomorrowSchedules.map((row) => row.id)).toEqual(['tomorrow']);
    expect(state.scheduleAvailable).toBe(true);
    expect(state.todaySchedules[0]).toMatchObject({ source_type: 'action', source_id: 'action-id' });
    expect(state.tomorrowSchedules[0]).toMatchObject({ source_type: 'habit', source_id: 'habit-id' });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('does not probe scheduling when the feature is disabled', async () => {
    mocks.enabled = false;
    expect((await loadSchedules('user', '2026-09-28', '2026-09-29')).scheduleAvailable).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps review and Home loading functional when schedule schema is missing', async () => {
    mocks.from.mockImplementation((table) => builder(table === 'today_v2_schedule_blocks'
      ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
      : { data: table === 'today_v2_daily_reviews' ? { id: 'review' } : [], error: null }));
    const state = await loadTodayReviewState('user', { now: new Date('2026-09-28T12:00:00Z'), timezoneName: 'UTC' });
    expect(state.review.id).toBe('review');
    expect(state.scheduleAvailable).toBe(false);
    expect(state.scheduleDiagnostic.code).toBe('42P01');
    // Home uses the same optional schedule dataset via its current review state.
    mocks.from.mockImplementation((table) => {
      if (table === 'today_v2_schedule_blocks') return builder({ error: { code: 'PGRST205', message: 'schema cache' } });
      const query = builder({ data: [], error: null });
      query.single.mockResolvedValue({ data: { id: 'review' }, error: null });
      return query;
    });
    expect((await loadTodayV2HomeState('user')).scheduleAvailable).toBe(false);
  });
  it('sends persisted UUIDs or null, never client keys, to stable replacement', async () => {
    const id = '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321';
    const rows = [{ id, fragment_order: 0, normalized_fragment_text: 'Write' }];
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const saved = await replaceTomorrowActions({
      targetLocalDate: '2026-09-29', sourceLocalDate: '2026-09-28', timezoneName: 'UTC',
      rawPlanText: '', actionTexts: ['Write', 'Walk'], fragmentIds: [id, null], scheduleAvailable: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('today_v2_replace_plan_stable', expect.objectContaining({
      p_fragment_ids: [id, null],
    }));
    expect(saved.savedFragments).toEqual(rows);
  });
  it('refetches real fragments after legacy replacement when flag is off', async () => {
    mocks.enabled = false;
    const rows = [{ id: 'real-id', fragment_order: 0, normalized_fragment_text: 'Write' }];
    mocks.from.mockReturnValue(builder({ data: rows, error: null }));
    const saved = await replaceTomorrowActions({
      targetLocalDate: '2026-09-29', sourceLocalDate: '2026-09-28', timezoneName: 'UTC',
      rawPlanText: '', actionTexts: ['Write'], scheduleAvailable: true, userId: 'user',
    });
    expect(mocks.rpc.mock.calls[0][0]).not.toBe('today_v2_replace_plan_stable');
    expect(saved.savedFragments).toEqual(rows);
  });
  it('falls back to legacy plan saving with a diagnostic when the stable RPC is missing', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'function missing from schema cache' } });
    const saved = await replaceTomorrowActions({
      targetLocalDate: '2026-09-29', sourceLocalDate: '2026-09-28', timezoneName: 'UTC',
      rawPlanText: '', actionTexts: ['Write'], scheduleAvailable: true, userId: 'user',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(saved.scheduleAvailable).toBe(false);
    expect(saved.scheduleDiagnostic.code).toBe('PGRST202');
  });
  it('rejects client keys as persisted fragment references and honors an explicit empty plan', async () => {
    await replaceTomorrowActions({
      targetLocalDate: '2026-09-29', sourceLocalDate: '2026-09-28', timezoneName: 'UTC',
      rawPlanText: 'Write', actionTexts: ['Write'], fragmentIds: ['local-0'], scheduleAvailable: true,
    });
    expect(mocks.rpc.mock.calls[0][1].p_fragment_ids).toEqual([null]);
    await replaceTomorrowActions({
      targetLocalDate: '2026-09-29', sourceLocalDate: '2026-09-28', timezoneName: 'UTC',
      rawPlanText: 'Write', actionTexts: [], scheduleAvailable: true, explicitActions: true,
    });
    expect(mocks.rpc.mock.calls[1][1].p_fragment_texts).toEqual([]);
  });
  it('uses atomic schedule replacement and propagates failures for dirty recovery', async () => {
    const blocks = [{ source_type: 'habit', source_id: 'habit-id', starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' }];
    await replaceSchedule({ targetLocalDate: '2026-09-29', timezoneName: 'UTC', blocks });
    expect(mocks.rpc).toHaveBeenCalledWith('today_v2_replace_schedule', {
      p_target_local_date: '2026-09-29', p_timezone_name: 'UTC',
      p_blocks: [{ habit_definition_id: 'habit-id', starts_at: blocks[0].starts_at, ends_at: blocks[0].ends_at }],
    });
    mocks.rpc.mockResolvedValue({ error: new Error('schedule failed') });
    await expect(replaceSchedule({ targetLocalDate: '2026-09-29', timezoneName: 'UTC', blocks })).rejects.toThrow('schedule failed');
  });

  it('maps actual SQL-shaped schedule results and sends exclusive native FK source columns', async () => {
    const nativeRows = [
      { id: 'block-action', user_id: 'user', target_local_date: '2026-09-29', timezone_name: 'UTC',
        commitment_fragment_id: 'fragment-id', habit_definition_id: null,
        starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' },
      { id: 'block-habit', user_id: 'user', target_local_date: '2026-09-29', timezone_name: 'UTC',
        commitment_fragment_id: null, habit_definition_id: 'habit-id',
        starts_at: '2026-09-29T11:00:00Z', ends_at: '2026-09-29T11:30:00Z' },
    ];
    mocks.rpc.mockResolvedValue({ data: nativeRows, error: null });
    const saved = await replaceSchedule({
      targetLocalDate: '2026-09-29', timezoneName: 'UTC',
      blocks: [
        { source_type: 'action', source_id: 'fragment-id', starts_at: nativeRows[0].starts_at, ends_at: nativeRows[0].ends_at },
        { source_type: 'habit', source_id: 'habit-id', starts_at: nativeRows[1].starts_at, ends_at: nativeRows[1].ends_at },
      ],
    });
    expect(mocks.rpc.mock.calls[0][1].p_blocks).toEqual([
      { commitment_fragment_id: 'fragment-id', starts_at: nativeRows[0].starts_at, ends_at: nativeRows[0].ends_at },
      { habit_definition_id: 'habit-id', starts_at: nativeRows[1].starts_at, ends_at: nativeRows[1].ends_at },
    ]);
    expect(saved[0]).toMatchObject({ ...nativeRows[0], source_type: 'action', source_id: 'fragment-id' });
    expect(saved[1]).toMatchObject({ ...nativeRows[1], source_type: 'habit', source_id: 'habit-id' });
  });
});
