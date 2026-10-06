import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), habit: vi.fn(), completion: vi.fn(), navigate: vi.fn(), enabled: true }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../lib/featureFlags', () => ({ get ENABLE_TODAY_V2_SCHEDULER() { return mocks.enabled; } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../v2/services/todayReview', () => ({ loadTodayV2HomeState: mocks.load, upsertHabitLog: mocks.habit, setFollowThroughCompletion: mocks.completion }));
import HomeV2Page from '../v2/pages/HomeV2Page';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('scheduled Home check-ins', () => {
  let root;
  let container;
  const habit = { id: 'occurrence', habit_definition_id: 'definition', snapshot_name: 'Read', snapshot_response_type: 'boolean', boolean_response: null, answered_at: null };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.load.mockResolvedValue({
      review: { completed_at: null }, todayLocalDate: '2026-10-07', timezoneName: 'UTC', dayBoundaryHour: 4,
      followThroughItems: [{ id: 'commitment', normalized_fragment_text: 'Write', completion_state: 'unanswered' }],
      tomorrowFragments: [], habitOccurrences: [habit],
      todaySchedules: [{ commitment_fragment_id: 'commitment', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' }, { habit_definition_id: 'definition', starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T10:30:00Z' }],
      metrics: { reviewStreak: 0, sevenDayCommitmentRate: {}, thirtyDayCommitmentRate: {}, sevenDayDots: [], perHabitRates: [] },
    });
    mocks.habit.mockResolvedValue({ ...habit, boolean_response: true, answered_at: '2026-10-07T10:10:00Z' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const render = async () => act(async () => root.render(<HomeV2Page />));

  it('shows persisted times and writes habit responses to the same occurrence', async () => {
    await render();
    expect(container.textContent).toContain('Today\'s habits');
    expect(container.textContent).toMatch(/9:00|09:00/);
    expect(container.textContent).toMatch(/10:00/);
    const yes = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Yes');
    await act(async () => yes.click());
    expect(mocks.habit).toHaveBeenCalledWith('occurrence', 'boolean', true);
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('hides scheduler-only display when the feature flag is off', async () => {
    mocks.enabled = false;
    await render();
    expect(container.textContent).not.toContain('Today\'s habits');
    expect(container.textContent).not.toMatch(/9:00|09:00/);
    expect(container.textContent).toContain('Write');
  });
});
