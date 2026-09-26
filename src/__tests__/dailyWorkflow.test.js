import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

import { dailyWorkflow } from '../lib/supabase/dailyWorkflow';

function createQueryBuilder(table, eqCalls, containsCalls) {
  let orderCalls = 0;

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column, value) => {
      eqCalls.push({ table, column, value });
      return builder;
    }),
    contains: vi.fn((column, value) => {
      containsCalls.push({ table, column, value });
      return builder;
    }),
    order: vi.fn(() => {
      orderCalls += 1;
      const requiresTwoOrders = table === 'daily_plan_actions' || table === 'daily_action_reviews';
      if (requiresTwoOrders && orderCalls === 1) return builder;

      if (table === 'daily_plan_actions') return Promise.resolve({ data: [], error: null });
      if (table === 'daily_action_reviews') return Promise.resolve({ data: [], error: null });
      if (table === 'user_habits') return Promise.resolve({ data: [], error: null });
      if (table === 'habit_checkins') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    }),
    maybeSingle: vi.fn(() => Promise.resolve({
      data: {
        tomorrow_commitment: 'Minimum: Call three leads. Stretch: Send two follow-ups.',
        commitment_minimum: null,
        commitment_stretch: null,
      },
      error: null,
    })),
  };

  return builder;
}

describe('dailyWorkflow.loadReviewData', () => {
  let eqCalls;
  let containsCalls;

  beforeEach(() => {
    eqCalls = [];
    containsCalls = [];
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table) => createQueryBuilder(table, eqCalls, containsCalls));
  });

  it('loads published plan rows for the review date (next-day Today compatibility)', async () => {
    await dailyWorkflow.loadReviewData('user-1', '2026-09-26');

    const planDateFilter = eqCalls.find((call) => call.table === 'daily_plan_actions' && call.column === 'plan_date');
    expect(planDateFilter?.value).toBe('2026-09-26');

    const reviewDateFilter = eqCalls.find((call) => call.table === 'daily_action_reviews' && call.column === 'review_date');
    expect(reviewDateFilter?.value).toBe('2026-09-26');

    expect(rpcMock).toHaveBeenCalledWith('seed_default_habits_for_user', { p_user_id: 'user-1' });
    expect(containsCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'user_habits', column: 'scheduled_days' }),
    ]));
  });

  it('includes legacy yesterday commitment fields for fallback follow-through rows', async () => {
    const result = await dailyWorkflow.loadReviewData('user-1', '2026-09-26');

    expect(result.yesterdayCommitment).toBe('Minimum: Call three leads. Stretch: Send two follow-ups.');
    expect(result.yesterdayCommitmentMinimum).toBeNull();
    expect(result.yesterdayCommitmentStretch).toBeNull();

    const yesterdayFilter = eqCalls.find((call) => call.table === 'reflection_sessions' && call.column === 'date');
    expect(yesterdayFilter?.value).toBe('2026-09-25');
  });
});
