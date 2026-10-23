import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ history: vi.fn(), home: vi.fn(), user: { id: 'owner' } }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../lib/featureFlags', () => ({ ENABLE_TODAY_V2_SCHEDULER: false }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../v2/services/commitmentHistory', () => ({ loadCommitmentHistory: mocks.history }));
vi.mock('../v2/services/todayReview', () => ({ loadTodayV2HomeState: mocks.home }));
vi.mock('../lib/supabase/reflection', () => ({ reflectionHelpers: { getReflectionStreak: async () => 0 } }));
vi.mock('../lib/supabase/client', () => ({ supabase: { from: () => {
  const query = {};
  for (const method of ['select', 'eq', 'or', 'order', 'in']) query[method] = () => query;
  query.limit = async () => ({ data: [] });
  return query;
} } }));

import InsightsV2 from '../pages/InsightsV2';
import HomeV2Page from '../v2/pages/HomeV2Page';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('cohesive Today and Progress charts', () => {
  let container;
  let root;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    vi.clearAllMocks();
    mocks.user = { id: 'owner' };
    mocks.history.mockResolvedValue({
      fragments: [{ target_local_date: '2026-10-22', completion_state: 'kept' }],
      legacySessions: [{ date: '2025-01-01', commitment_score: 75 }],
    });
    mocks.home.mockResolvedValue({
      review: {}, todayLocalDate: '2026-10-22', timezoneName: 'UTC', dayBoundaryHour: 4,
      followThroughItems: [], habitOccurrences: [], tomorrowFragments: [],
      becomingRatings: [{ local_date: '2026-10-21', becoming_rating: 7 }],
      metrics: { reviewStreak: 0, sevenDayCommitmentRate: {}, thirtyDayCommitmentRate: {}, sevenDayDots: [] },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  const render = async (component) => act(async () => root.render(component));
  const rows = () => container.querySelectorAll('tbody tr');
  async function expandValues() {
    await act(async () => {
      const details = container.querySelector('details');
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
  }

  it('defaults to a rolling seven days and switches to month, year and all-time', async () => {
    await render(<InsightsV2 />);
    expect(mocks.history).toHaveBeenCalledWith('owner', '2026-10-22');
    expect(container.querySelector('[aria-label="Past 7 days"]').getAttribute('aria-pressed')).toBe('true');
    await expandValues();
    expect(rows()).toHaveLength(7);
    for (const [label, count] of [['Past month', 30], ['Past year', 365]]) {
      await act(async () => container.querySelector(`[aria-label="${label}"]`).click());
      expect(rows()).toHaveLength(count);
    }
    await act(async () => container.querySelector('[aria-label="All time"]').click());
    expect(rows().length).toBeGreaterThan(365);
    expect(container.textContent).toContain('75%');
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });

  it('shows loading errors and retries without substituting a fake zero', async () => {
    mocks.history.mockRejectedValueOnce(new Error('Offline'));
    await render(<InsightsV2 />);
    expect(container.querySelector('[role="alert"]').textContent).toContain('Could not load');
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Try again').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('100%');
  });

  it('uses the same fine-line chart for the seven-day becoming history on Today', async () => {
    await render(<HomeV2Page />);
    const chart = container.querySelector('[aria-label="Becoming"]');
    expect(chart.textContent).toContain('7/10');
    expect(chart.querySelector('[data-trend-line]').getAttribute('stroke-width')).toBe('1.25');
    await expandValues();
    expect(rows()).toHaveLength(7);
    expect(rows()[0].textContent).toContain('Oct 16');
    expect(rows()[6].textContent).toContain('No entry');
  });
});
