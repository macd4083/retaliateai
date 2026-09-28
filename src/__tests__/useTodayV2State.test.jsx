import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const serviceMocks = vi.hoisted(() => ({
  addManualFollowThroughItem: vi.fn(),
  archiveHabit: vi.fn(),
  buildEmptyHabitDefinition: vi.fn(() => ({
    id: null,
    name: '',
    response_type: 'boolean',
    unit: '',
    schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
    display_order: 0,
  })),
  completeTodayV2Review: vi.fn(),
  loadTodayReviewState: vi.fn(),
  reopenTodayV2Review: vi.fn(),
  replaceTomorrowActions: vi.fn(),
  setFollowThroughCompletion: vi.fn(),
  updateDesiredDirection: vi.fn(),
  upsertHabitDefinition: vi.fn(),
  upsertHabitLog: vi.fn(),
}));

vi.mock('../v2/services/todayReview', () => serviceMocks);

import { useTodayV2State } from '../v2/today/useTodayV2State';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeState({ todayLocalDate = '2026-09-28', tomorrowLocalDate = '2026-09-29' } = {}) {
  return {
    timezoneName: 'UTC',
    dayBoundaryHour: 4,
    yesterdayLocalDate: '2026-09-27',
    todayLocalDate,
    tomorrowLocalDate,
    review: {
      id: `review-${todayLocalDate}`,
      local_date: todayLocalDate,
      timezone_name: 'UTC',
      desired_direction: '',
      completed_at: null,
      updated_at: `${todayLocalDate}T12:00:00.000Z`,
    },
    routeTarget: '/today',
    draftStorageKey: `today-v2-draft:user-1:${todayLocalDate}`,
    seedDiagnostic: null,
    followThroughItems: [],
    tomorrowPlanInput: '',
    tomorrowPlanMeta: null,
    tomorrowFragments: [],
    habitDefinitions: [],
    habitOccurrences: [],
  };
}

function HookProbe({ userId, onRender }) {
  onRender(useTodayV2State(userId));
  return null;
}

async function waitForCondition(condition, description = 'condition', timeout = 2000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (condition()) return;
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error(`Timed out after ${timeout}ms waiting for ${description}`);
}

describe('useTodayV2State', () => {
  let container;
  let root;
  let latest;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T22:00:00.000Z'));
    vi.clearAllMocks();
    window.localStorage.clear();

    serviceMocks.loadTodayReviewState.mockResolvedValue(makeState());
    serviceMocks.updateDesiredDirection.mockResolvedValue(undefined);
    serviceMocks.replaceTomorrowActions.mockImplementation(async ({ rawPlanText, actionTexts }) => ({
      rawPlanText: rawPlanText.trim(),
      fragments: actionTexts,
    }));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = undefined;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  async function renderHook() {
    await act(async () => {
      root.render(<HookProbe userId="user-1" onRender={(value) => { latest = value; }} />);
    });
    await waitForCondition(() => latest && latest.loading === false, 'initial hook load');
  }

  it('autosaves desired direction and tomorrow plans after the debounce window', async () => {
    await renderHook();

    await act(async () => {
      latest.setDesiredDirection('Builder');
      latest.setTomorrowInput('Write 20 minutes and review notes');
    });

    await act(async () => {
      vi.advanceTimersByTime(801);
      await Promise.resolve();
    });

    await waitForCondition(() => serviceMocks.updateDesiredDirection.mock.calls.length > 0, 'direction autosave');
    await waitForCondition(() => serviceMocks.replaceTomorrowActions.mock.calls.length > 0, 'plan autosave');

    expect(serviceMocks.updateDesiredDirection).toHaveBeenCalledWith('review-2026-09-28', 'Builder');
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      targetLocalDate: '2026-09-29',
      sourceLocalDate: '2026-09-28',
      rawPlanText: 'Write 20 minutes and review notes',
      actionTexts: ['Write 20 minutes', 'review notes'],
    }));
  });

  it('flushes pending autosaves when the page becomes hidden', async () => {
    await renderHook();

    await act(async () => {
      latest.setDesiredDirection('Builder');
      latest.setTomorrowInput('Write 20 minutes');
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(serviceMocks.updateDesiredDirection).toHaveBeenCalledWith('review-2026-09-28', 'Builder');
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      rawPlanText: 'Write 20 minutes',
      actionTexts: ['Write 20 minutes'],
    }));
  });

  it('reloads stale in-memory state after a visibility change across the review-day boundary', async () => {
    serviceMocks.loadTodayReviewState
      .mockResolvedValueOnce(makeState({ todayLocalDate: '2026-09-28', tomorrowLocalDate: '2026-09-29' }))
      .mockResolvedValueOnce(makeState({ todayLocalDate: '2026-09-29', tomorrowLocalDate: '2026-09-30' }));

    vi.setSystemTime(new Date('2026-09-29T03:55:00.000Z'));
    await renderHook();
    expect(latest.state.todayLocalDate).toBe('2026-09-28');

    vi.setSystemTime(new Date('2026-09-29T04:05:00.000Z'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    await waitForCondition(() => latest.state?.todayLocalDate === '2026-09-29', 'rollover reload');
    expect(serviceMocks.loadTodayReviewState).toHaveBeenCalledTimes(2);
  });
});
