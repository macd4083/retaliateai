import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), range: vi.fn(), eq: vi.fn(), lte: vi.fn(), order: vi.fn() }));
vi.mock('../lib/supabase/client', () => ({ supabase: { from: mocks.from } }));
import { loadCommitmentHistory } from '../v2/services/commitmentHistory';

describe('commitment chart history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = { select: vi.fn().mockReturnThis(), eq: mocks.eq, lte: mocks.lte, order: mocks.order, range: mocks.range };
    mocks.from.mockReturnValue(query);
    mocks.eq.mockReturnValue(query);
    mocks.lte.mockReturnValue(query);
    mocks.order.mockReturnValue(query);
  });

  it('paginates all-time data and scopes both sources to the user and review date', async () => {
    mocks.range.mockImplementation(async (start) => ({
      data: start === 0 ? Array.from({ length: 1000 }, (_, id) => ({ id })) : [{ id: 1001 }],
    }));
    const result = await loadCommitmentHistory('owner', '2026-10-22');
    expect(result.fragments).toHaveLength(1001);
    expect(result.legacySessions).toHaveLength(1001);
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(mocks.lte).toHaveBeenCalledWith('target_local_date', '2026-10-22');
    expect(mocks.lte).toHaveBeenCalledWith('date', '2026-10-22');
    expect(mocks.range).toHaveBeenCalledWith(1000, 1999);
    expect(mocks.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('surfaces database errors instead of returning misleading empty history', async () => {
    mocks.range.mockResolvedValue({ error: new Error('Unavailable') });
    await expect(loadCommitmentHistory('owner', '2026-10-22')).rejects.toThrow('Unavailable');
  });
});
