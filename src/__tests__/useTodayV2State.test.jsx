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
  removeUnansweredFollowThroughItem: vi.fn(),
  setFollowThroughCompletion: vi.fn(),
  updateDesiredDirection: vi.fn(),
  updateControllableFocus: vi.fn(),
  upsertHabitDefinition: vi.fn(),
  upsertHabitLog: vi.fn(),
}));
const scheduleMocks = vi.hoisted(() => ({ replaceSchedule: vi.fn() }));

vi.mock('../v2/services/todayReview', () => serviceMocks);
vi.mock('../lib/featureFlags', () => ({ ENABLE_TODAY_V2_SCHEDULER: true }));
vi.mock('../v2/services/scheduling', () => ({
  replaceSchedule: scheduleMocks.replaceSchedule,
  isMissingScheduleSchema: (error) => error?.code === 'PGRST202',
}));

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
      controllable_focus: null,
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
    scheduleMocks.replaceSchedule.mockImplementation(async ({ blocks }) => blocks.map((block, index) => ({ ...block, id: `block-${index}` })));
    serviceMocks.updateDesiredDirection.mockResolvedValue(undefined);
    serviceMocks.updateControllableFocus.mockResolvedValue(undefined);
    serviceMocks.replaceTomorrowActions.mockImplementation(async ({ rawPlanText, actionTexts }) => ({
      rawPlanText: rawPlanText.trim(),
      fragments: actionTexts,
      savedFragments: actionTexts.map((text, index) => ({
        id: `fragment-${index}`, fragment_order: index, normalized_fragment_text: text, fragment_text: text,
      })),
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
      latest.setControllableFocus('Protect the first work block');
      latest.setTomorrowInput('Write 20 minutes and review notes');
      latest.setFirstFiveMinutes('Open the outline and write one sentence');
    });

    await act(async () => {
      vi.advanceTimersByTime(801);
      await Promise.resolve();
    });

    await waitForCondition(() => serviceMocks.updateDesiredDirection.mock.calls.length > 0, 'direction autosave');
    await waitForCondition(() => serviceMocks.updateControllableFocus.mock.calls.length > 0, 'controllable focus autosave');
    await waitForCondition(() => serviceMocks.replaceTomorrowActions.mock.calls.length > 0, 'plan autosave');

    expect(serviceMocks.updateDesiredDirection).toHaveBeenCalledWith('review-2026-09-28', 'Builder');
    expect(serviceMocks.updateControllableFocus).toHaveBeenCalledWith('review-2026-09-28', 'Protect the first work block');
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      targetLocalDate: '2026-09-29',
      sourceLocalDate: '2026-09-28',
      rawPlanText: 'Write 20 minutes and review notes',
      actionTexts: ['Write 20 minutes', 'review notes'],
      firstFiveMinutes: 'Open the outline and write one sentence',
    }));
  });

  it('flushes pending autosaves when the page becomes hidden', async () => {
    await renderHook();

    await act(async () => {
      latest.setDesiredDirection('Builder');
      latest.setControllableFocus('Protect the first work block');
      latest.setTomorrowInput('Write 20 minutes');
      latest.setFirstFiveMinutes('Open the outline');
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
    expect(serviceMocks.updateControllableFocus).toHaveBeenCalledWith('review-2026-09-28', 'Protect the first work block');
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      rawPlanText: 'Write 20 minutes',
      actionTexts: ['Write 20 minutes'],
      firstFiveMinutes: 'Open the outline',
    }));
  });

  it('saves first five minutes through the plan replacement path', async () => {
    await renderHook();

    await act(async () => {
      latest.setTomorrowInput('Write 20 minutes');
      latest.setFirstFiveMinutes('Open the document');
    });
    await act(async () => {
      vi.advanceTimersByTime(801);
      await Promise.resolve();
    });

    await waitForCondition(() => serviceMocks.replaceTomorrowActions.mock.calls.length > 0, 'first five minutes plan save');
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      targetLocalDate: '2026-09-29',
      firstFiveMinutes: 'Open the document',
    }));
  });

  it('resets completion saving and rethrows when a flush fails', async () => {
    await renderHook();
    serviceMocks.updateDesiredDirection.mockRejectedValueOnce(new Error('flush failed'));

    await act(async () => {
      latest.setDesiredDirection('Builder');
    });

    await act(async () => {
      await expect(latest.completeReview()).rejects.toThrow('flush failed');
    });

    expect(latest.completionSaving).toBe(false);
    expect(serviceMocks.completeTodayV2Review).not.toHaveBeenCalled();
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

  it('keeps schedules with edited and reordered identities and removes only deleted schedules', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({ ...makeState(), scheduleAvailable: true });
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Write', 'Walk', 'Read']); });
    const keys = latest.schedulerItems.map((item) => item.id);
    await act(async () => {
      latest.updateSchedule(keys[0], { starts_at: '2026-09-29T10:00:00Z' });
      latest.editTomorrowAction(0, 'Write more');
      latest.setTomorrowActions((previous) => [previous[2], previous[0], previous[1]]);
    });
    expect(latest.schedulerItems.map((item) => item.id)).toEqual([keys[2], keys[0], keys[1]]);
    expect(latest.scheduleBlocks[0].source_key).toBe(keys[0]);
    await act(async () => { latest.removeTomorrowAction(1); });
    expect(latest.scheduleBlocks).toEqual([]);
    expect(latest.tomorrowActions).toEqual(['Read', 'Walk']);
  });

  it('does not move a time to an unrelated automatically split action', async () => {
    await renderHook();
    await act(async () => { latest.setTomorrowInput('Write and Walk'); });
    const key = latest.schedulerItems[0].id;
    await act(async () => {
      latest.updateSchedule(key, { starts_at: '2026-09-29T10:00:00Z' });
      latest.setTomorrowInput('Read and Walk');
    });
    expect(latest.schedulerItems[0].id).not.toBe(key);
    expect(latest.scheduleBlocks).toEqual([]);
  });

  it('saves the plan first and schedules only real returned source IDs, including tomorrow habits', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true,
      habitDefinitions: [
        { id: 'tuesday', name: 'Tuesday habit', schedule_weekdays: [2] },
        { id: 'monday', name: 'Monday habit', schedule_weekdays: [1] },
      ],
    });
    await renderHook();
    expect(latest.schedulerItems.map((item) => item.source_id)).toEqual(['tuesday']);
    await act(async () => { latest.setTomorrowActions(['Write']); });
    const key = latest.schedulerItems[0].id;
    await act(async () => {
      latest.updateSchedule(key, { starts_at: '2026-09-29T10:00:00Z' });
      latest.updateSchedule('habit:tuesday', { starts_at: '2026-09-29T11:00:00Z' });
      await latest.flushSchedule();
    });
    expect(serviceMocks.replaceTomorrowActions.mock.invocationCallOrder[0]).toBeLessThan(scheduleMocks.replaceSchedule.mock.invocationCallOrder[0]);
    expect(scheduleMocks.replaceSchedule).toHaveBeenCalledWith(expect.objectContaining({
      blocks: [
        expect.objectContaining({ source_type: 'action', source_id: 'fragment-0' }),
        expect.objectContaining({ source_type: 'habit', source_id: 'tuesday' }),
      ],
    }));
    expect(latest.schedulerItems[0].id).toBe(key);
    expect(latest.state.tomorrowFragments[0].id).toBe('fragment-0');
  });

  it('recovers unsaved schedule keys and edits from the local draft after reload', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({ ...makeState(), scheduleAvailable: true });
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Write']); });
    const key = latest.schedulerItems[0].id;
    await act(async () => { latest.updateSchedule(key, { starts_at: '2026-09-29T10:00:00Z' }); });
    const draft = JSON.parse(window.localStorage.getItem('today-v2-draft:user-1:2026-09-28'));
    expect(draft.actionIdentities[0].key).toBe(key);
    expect(draft.scheduleNeedsSync).toBe(true);
    await act(async () => { await latest.load(); });
    expect(latest.schedulerItems[0].id).toBe(key);
    expect(latest.scheduleBlocks[0].source_key).toBe(key);
  });

  it('preserves dirty scheduling after plan failure and never calls the schedule RPC', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({ ...makeState(), scheduleAvailable: true });
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Write']); });
    await act(async () => { latest.updateSchedule(latest.schedulerItems[0].id, { starts_at: '2026-09-29T10:00:00Z' }); });
    serviceMocks.replaceTomorrowActions.mockRejectedValueOnce(new Error('plan failed'));
    await act(async () => { await expect(latest.flushSchedule()).rejects.toThrow('plan failed'); });
    expect(scheduleMocks.replaceSchedule).not.toHaveBeenCalled();
    expect(latest.scheduleBlocks).toHaveLength(1);
    expect(latest.scheduleSaveStatus).toBe('error');
    expect(JSON.parse(window.localStorage.getItem('today-v2-draft:user-1:2026-09-28')).scheduleNeedsSync).toBe(true);
  });

  it('does not overwrite edits made while a plan save is in flight', async () => {
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Write']); });
    let resolveSave;
    serviceMocks.replaceTomorrowActions.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    let pending;
    await act(async () => { pending = latest.saveTomorrowPlan(); });
    await act(async () => { latest.editTomorrowAction(0, 'Write more'); });
    await act(async () => {
      resolveSave({ rawPlanText: '', fragments: ['Write'], savedFragments: [{ id: 'first-id', normalized_fragment_text: 'Write' }] });
      await pending;
    });
    expect(latest.tomorrowActions).toEqual(['Write more']);
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledTimes(2);
    expect(serviceMocks.replaceTomorrowActions.mock.calls[1][0].fragmentIds).toEqual(['first-id']);
  });

  it('blocks completion visibly when missing schema leaves pending schedules unavailable', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({ ...makeState(), scheduleAvailable: true });
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Write']); });
    await act(async () => { latest.updateSchedule(latest.schedulerItems[0].id, { starts_at: '2026-09-29T10:00:00Z' }); });
    scheduleMocks.replaceSchedule.mockRejectedValueOnce(Object.assign(new Error('schema cache missing RPC'), { code: 'PGRST202' }));
    await act(async () => { await expect(latest.flushSchedule()).rejects.toThrow(/schema cache/); });
    expect(latest.scheduleAvailable).toBe(false);
    await act(async () => { await expect(latest.completeReview()).rejects.toThrow(/Pending schedule changes/); });
    expect(serviceMocks.completeTodayV2Review).not.toHaveBeenCalled();
    expect(latest.scheduleSaveStatus).toBe('error');
    expect(latest.scheduleBlocks).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('today-v2-draft:user-1:2026-09-28')).scheduleNeedsSync).toBe(true);
  });

  it('removes only unanswered follow-through items', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), followThroughItems: [
        { id: 'unanswered', completion_state: 'unanswered', answered_at: null },
        { id: 'answered', completion_state: 'kept', answered_at: '2026-09-28T10:00:00Z' },
      ],
    });
    serviceMocks.removeUnansweredFollowThroughItem.mockResolvedValue('unanswered');
    await renderHook();
    await act(async () => { await expect(latest.removeFollowThrough('answered')).rejects.toThrow(/unanswered/); });
    expect(serviceMocks.removeUnansweredFollowThroughItem).not.toHaveBeenCalled();
    await act(async () => { await latest.removeFollowThrough('unanswered'); });
    expect(serviceMocks.removeUnansweredFollowThroughItem).toHaveBeenCalledWith('user-1', 'unanswered');
    expect(latest.state.followThroughItems.map((row) => row.id)).toEqual(['answered']);
  });

  it('saves deleting the last action as an empty explicit list, without re-splitting the paragraph', async () => {
    await renderHook();
    await act(async () => { latest.setTomorrowInput('Write'); });
    await act(async () => { latest.removeTomorrowAction(0); });
    await act(async () => { await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      rawPlanText: 'Write', actionTexts: [], explicitActions: true,
    }));
    expect(latest.tomorrowActions).toEqual([]);
  });

  it('drains schedule edits made during atomic replacement without stale overwrite', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({ ...makeState(), scheduleAvailable: true });
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Write']); });
    const key = latest.schedulerItems[0].id;
    await act(async () => {
      latest.updateSchedule(key, { starts_at: '2026-09-29T10:00:00Z' });
    });
    let resolveSchedule;
    scheduleMocks.replaceSchedule.mockImplementationOnce(() => new Promise((resolve) => { resolveSchedule = resolve; }));
    let pending;
    await act(async () => { pending = latest.flushSchedule(); });
    await act(async () => { latest.updateSchedule(key, { starts_at: '2026-09-29T12:00:00Z' }); });
    await act(async () => {
      resolveSchedule([{ source_type: 'action', source_id: 'fragment-0', starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' }]);
      await pending;
    });
    expect(scheduleMocks.replaceSchedule).toHaveBeenCalledTimes(2);
    expect(latest.scheduleBlocks[0].starts_at).toBe('2026-09-29T12:00:00.000Z');
    expect(latest.scheduleSaveStatus).toBe('saved');
  });
});
