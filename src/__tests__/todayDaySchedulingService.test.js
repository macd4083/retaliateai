import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase/client', () => ({ supabase: mocks }));
import { updateDaySchedule, upsertDaySchedule, removeDaySchedule } from '../v2/services/scheduling';

describe('current civil-day scheduling service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it.each(['action', 'habit'])('updates only one persisted %s schedule and normalizes the day response', async (sourceType) => {
    const sourceId = '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321';
    const row = { id: 'existing-block', source_review_id: 'completed-source',
      [sourceType === 'action' ? 'commitment_fragment_id' : 'habit_definition_id']: sourceId };
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    const saved = await updateDaySchedule({ targetLocalDate: '2026-09-29', timezoneName: 'UTC',
      sourceType, sourceId, startsAt: '2026-09-29T10:00:00Z', endsAt: '2026-09-29T10:30:00Z' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('today_v2_update_day_schedule', {
      p_target_local_date: '2026-09-29', p_timezone_name: 'UTC', p_source_type: sourceType,
      p_source_id: sourceId, p_starts_at: '2026-09-29T10:00:00Z', p_ends_at: '2026-09-29T10:30:00Z',
    });
    expect(saved).toEqual([{ ...row, source_type: sourceType, source_id: sourceId }]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('removes one identity with explicit null times and never falls back to destructive replacement', async () => {
    const identity = { targetLocalDate: '2026-09-29', timezoneName: 'UTC',
      sourceType: 'habit', sourceId: '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321' };
    expect(await removeDaySchedule(identity)).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith('today_v2_update_day_schedule', expect.objectContaining({
      p_source_id: identity.sourceId, p_starts_at: null, p_ends_at: null,
    }));
    mocks.rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Missing day RPC' } });
    await expect(removeDaySchedule(identity)).rejects.toMatchObject({ code: 'PGRST202' });
    expect(mocks.rpc.mock.calls.every(([name]) => name === 'today_v2_update_day_schedule')).toBe(true);
  });

  it('exports one canonical identity updater with explicit-null removal', async () => {
    expect(upsertDaySchedule).toBe(updateDaySchedule);
    const input = { targetLocalDate: '2026-09-29', timezoneName: 'UTC',
      sourceType: 'action', sourceId: '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321',
      startsAt: null, endsAt: null };
    expect(await updateDaySchedule(input)).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('today_v2_update_day_schedule', {
      p_target_local_date: input.targetLocalDate, p_timezone_name: input.timezoneName,
      p_source_type: input.sourceType, p_source_id: input.sourceId, p_starts_at: null, p_ends_at: null,
    });
  });

  it('rejects client-only identities and incomplete times before invoking the day RPC', async () => {
    const input = { sourceType: 'action', sourceId: 'local-0', startsAt: null, endsAt: null };
    await expect(updateDaySchedule(input)).rejects.toThrow('persisted');
    await expect(updateDaySchedule({ ...input, sourceId: '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321',
      endsAt: undefined })).rejects.toThrow('explicit nulls');
    await expect(updateDaySchedule({ ...input, sourceId: '8cfde77d-dcaa-4c7c-a409-f9ef5e70e321',
      sourceType: 'manual' })).rejects.toThrow('persisted');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
