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
  updateControllableFocus: vi.fn(),
  upsertHabitDefinition: vi.fn(),
  upsertHabitLog: vi.fn(),
}));
const scheduleMocks = vi.hoisted(() => ({ replaceSchedule: vi.fn() }));
const pageMocks = vi.hoisted(() => ({ navigate: vi.fn(), userId: 'user-1' }));

vi.mock('../v2/services/todayReview', () => serviceMocks);
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: pageMocks.userId } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => pageMocks.navigate }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../v2/components/GoogleCalendarConnection', () => ({
  default: ({ localDate, includeNextDay, onEvents }) => {
    React.useEffect(() => onEvents?.([{ id: 'calendar-event', title: 'Calendar event', start: '2026-09-29T09:00:00Z', end: '2026-09-29T09:30:00Z' }]), [onEvents]);
    return <div data-calendar-local-date={localDate} data-calendar-next-day={String(includeNextDay)}>Google Calendar</div>;
  },
}));
vi.mock('../lib/featureFlags', () => ({ ENABLE_TODAY_V2_SCHEDULER: true }));
vi.mock('../v2/services/scheduling', () => ({
  replaceSchedule: scheduleMocks.replaceSchedule,
  isMissingScheduleSchema: (error) => error?.code === 'PGRST202',
}));

import { useTodayV2State } from '../v2/today/useTodayV2State';
import TodayV2Page from '../v2/pages/TodayV2Page';

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
    pageMocks.userId = 'user-1';
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

  it('replaces the saved direction on every edit without using autofill', async () => {
    await renderHook();
    for (const direction of ['Builder', 'Patient builder']) {
      await act(async () => { latest.setDesiredDirection(direction); });
      await act(async () => { await vi.advanceTimersByTimeAsync(801); });
      expect(serviceMocks.updateDesiredDirection).toHaveBeenLastCalledWith('review-2026-09-28', direction);
      expect(latest.state.review.desired_direction).toBe(direction);
    }
    await act(async () => { await latest.load(); });
    expect(latest.desiredDirection).toBe('Patient builder');
  });

  it('pairs calendar labels with each start and preserves line-only edits when saving', async () => {
    await renderHook();
    await act(async () => {
      latest.setTomorrowActions(['Write', 'Run', 'Read']);
      latest.setFirstFiveMinutes('Open notes\nPut on shoes');
    });
    expect(latest.schedulerItems.map((item) => item.label)).toEqual([
      'Write, Open notes', 'Run, Put on shoes', 'Read',
    ]);
    const keys = latest.tomorrowActionKeys;
    await act(async () => { await latest.saveTomorrowPlan(); });
    expect(latest.state.firstFiveMinutes).toBe('Open notes\nPut on shoes');
    await act(async () => { latest.setFirstFiveMinutes('Open notes Put on shoes'); });
    await act(async () => { await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledTimes(2);
    expect(latest.tomorrowActionKeys).toEqual(keys);
    await act(async () => { latest.setFirstFiveMinutes('\nPut on shoes\nOpen book'); });
    expect(latest.schedulerItems.map((item) => item.label)).toEqual([
      'Write', 'Run, Put on shoes', 'Read, Open book',
    ]);
    await act(async () => { latest.removeTomorrowAction(0); });
    expect(latest.schedulerItems.map((item) => item.label)).toEqual([
      'Run, Put on shoes', 'Read, Open book',
    ]);
  });

  it('places optional import controls beside the native planner and feeds it calendar events', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({ ...makeState(), scheduleAvailable: true });
    await act(async () => { root.render(<TodayV2Page />); });
    await waitForCondition(() => container.querySelector('[aria-label="Google events"]')?.textContent.includes('Calendar event'), 'calendar events in tomorrow schedule');
    const followThrough = [...container.querySelectorAll('section')].find((section) => section.querySelector('h3')?.textContent === '1. Follow-Through');
    const calendarConnection = container.querySelector('[data-calendar-local-date]');
    expect(followThrough.textContent).toContain("What were today's highest-ROI actions?");
    expect(calendarConnection.previousElementSibling.querySelector('h3')?.textContent).toBe('Schedule tomorrow');
    expect(followThrough.contains(calendarConnection)).toBe(false);
    expect(calendarConnection.getAttribute('data-calendar-local-date')).toBe('2026-09-29');
    expect(calendarConnection.getAttribute('data-calendar-next-day')).toBe('true');
    expect(container.querySelector('[aria-label="Google events"]').textContent).toContain('Calendar event');
  });

  it('autofills the stored direction beside Saved and shows the new planning prompts', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), previousDesiredDirection: 'Patient builder',
    });
    await act(async () => { root.render(<TodayV2Page />); });
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Autofill');
    expect(button.disabled).toBe(false);
    expect(button.previousElementSibling.textContent).toContain('Saved');
    expect(container.querySelector('textarea').value).toBe('');
    await act(async () => { button.click(); });
    expect(container.querySelector('textarea').value).toBe('Patient builder');
    expect(serviceMocks.updateDesiredDirection).toHaveBeenCalledWith('review-2026-09-28', 'Patient builder');
    expect(container.textContent).toContain('6.1 Identity Alignment');
    expect(container.textContent).toContain("What actions will align me the most with who I'm becoming?");
    expect(container.textContent).toContain('What will the start of each action look like?');
    expect(container.textContent).not.toContain('5.2');
    expect(container.textContent).not.toContain('Highest-ROI');
  });

  it('disables autofill when there is no saved direction or the review is locked', async () => {
    await act(async () => { root.render(<TodayV2Page />); });
    expect([...container.querySelectorAll('button')].find((node) => node.textContent === 'Autofill').disabled).toBe(true);
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), previousDesiredDirection: 'Builder',
      review: { ...makeState().review, completed_at: '2026-09-28T22:00:00Z' },
    });
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => { root.render(<TodayV2Page />); });
    expect([...container.querySelectorAll('button')].find((node) => node.textContent === 'Autofill').disabled).toBe(true);
    expect(serviceMocks.updateDesiredDirection).not.toHaveBeenCalled();
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

  it('preserves dirty previous-day drafts through a failed rollover and replaces them only after success', async () => {
    vi.setSystemTime(new Date('2026-09-29T03:55:00.000Z'));
    await renderHook();
    await act(async () => {
      latest.setDesiredDirection('Builder');
      latest.setControllableFocus('Protect the first block');
      latest.setTomorrowInput('Write');
      latest.setFirstFiveMinutes('Open the outline');
    });
    const oldKey = 'today-v2-draft:user-1:2026-09-28';
    const oldDraft = JSON.parse(window.localStorage.getItem(oldKey));
    let rejectLoad;
    serviceMocks.loadTodayReviewState.mockImplementationOnce(() => new Promise((_, reject) => { rejectLoad = reject; }));
    vi.setSystemTime(new Date('2026-09-29T04:05:00.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(latest.state.todayLocalDate).toBe('2026-09-28');
    expect(latest.tomorrowInput).toBe('Write');
    expect(JSON.parse(window.localStorage.getItem(oldKey))).toEqual(oldDraft);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => { rejectLoad(new Error('next day unavailable')); });
      expect(latest.loading).toBe(false);
      expect(latest.error.message).toBe('next day unavailable');
      expect(latest.state.todayLocalDate).toBe('2026-09-28');
      expect(latest.desiredDirection).toBe('Builder');
      expect(latest.controllableFocus).toBe('Protect the first block');
      expect(latest.tomorrowActions).toEqual(['Write']);
      expect(latest.firstFiveMinutes).toBe('Open the outline');
      expect(JSON.parse(window.localStorage.getItem(oldKey))).toEqual(oldDraft);

      serviceMocks.loadTodayReviewState.mockResolvedValueOnce(makeState({
        todayLocalDate: '2026-09-29', tomorrowLocalDate: '2026-09-30',
      }));
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      expect(latest.state.todayLocalDate).toBe('2026-09-29');
      expect(latest.desiredDirection).toBe('');
      expect(latest.controllableFocus).toBe('');
      expect(latest.tomorrowActions).toEqual([]);
      expect(latest.firstFiveMinutes).toBe('');
      expect(JSON.parse(window.localStorage.getItem(oldKey))).toEqual(oldDraft);
    } finally {
      consoleError.mockRestore();
    }
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

  it('saves identity-only duplicate resplits before scheduling new sources', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true, tomorrowPlanInput: 'Write and Write',
      tomorrowFragments: [
        { id: 'old-first', fragment_order: 0, fragment_text: 'Write', normalized_fragment_text: 'Write' },
        { id: 'old-second', fragment_order: 1, fragment_text: 'Write', normalized_fragment_text: 'Write' },
      ],
      tomorrowSchedules: [{ source_type: 'action', source_id: 'old-first',
        starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' }],
    });
    await renderHook();
    const oldKeys = latest.tomorrowActionKeys;
    await act(async () => { latest.splitTomorrowActions(); });
    expect(latest.tomorrowActions).toEqual(['Write', 'Write']);
    expect(latest.tomorrowActionKeys.every((key) => !oldKeys.includes(key))).toBe(true);
    expect(latest.scheduleBlocks).toEqual([]);
    await act(async () => {
      latest.updateSchedule(latest.tomorrowActionKeys[0], { starts_at: '2026-09-29T12:00:00Z' });
      await latest.flushSchedule();
    });
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({
      actionTexts: ['Write', 'Write'], fragmentIds: [null, null],
    }));
    expect(scheduleMocks.replaceSchedule).toHaveBeenCalledWith(expect.objectContaining({
      blocks: [expect.objectContaining({ source_id: 'fragment-0' })],
    }));
    expect(latest.scheduleSaveStatus).toBe('saved');
  });

  it('does not reuse persisted identities or schedules after delete and re-add of identical text', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true, tomorrowPlanInput: 'Write',
      tomorrowFragments: [{ id: 'old-id', fragment_order: 0, fragment_text: 'Write', normalized_fragment_text: 'Write' }],
      tomorrowSchedules: [{ source_type: 'action', source_id: 'old-id',
        starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' }],
    });
    await renderHook();
    const oldKey = latest.tomorrowActionKeys[0];
    await act(async () => {
      latest.removeTomorrowAction(0);
      latest.setTomorrowActions(['Write']);
    });
    expect(latest.tomorrowActions).toEqual(['Write']);
    expect(latest.tomorrowActionKeys[0]).not.toBe(oldKey);
    expect(latest.scheduleBlocks).toEqual([]);
    await act(async () => { await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({ fragmentIds: [null] }));
  });

  it('prioritizes persisted draft identity over another action with the same edited text', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true, tomorrowPlanInput: 'Write and Walk',
      tomorrowFragments: [
        { id: 'id1', fragment_order: 0, fragment_text: 'Write', normalized_fragment_text: 'Write' },
        { id: 'id2', fragment_order: 1, fragment_text: 'Walk', normalized_fragment_text: 'Walk' },
      ],
    });
    window.localStorage.setItem('today-v2-draft:user-1:2026-09-28', JSON.stringify({
      tomorrowInput: 'Write and Walk', tomorrowActions: ['Walk', 'Walk'], tomorrowPlanNeedsSync: true,
      actionIdentities: [
        { key: 'key1', text: 'Walk', persistedId: 'id1' },
        { key: 'key2', text: 'Walk', persistedId: 'id2' },
      ],
      scheduleNeedsSync: true,
      scheduleBlocks: [{ source_key: 'key1', source_type: 'action', source_id: 'id1',
        starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' }],
    }));
    await renderHook();
    expect(latest.tomorrowActionItems.map((item) => item.persistedId)).toEqual(['id1', 'id2']);
    expect(latest.scheduleBlocks[0].source_key).toBe('key1');
    await act(async () => { await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledWith(expect.objectContaining({ fragmentIds: ['id1', 'id2'] }));
  });

  it('defers blank-row autosave and retains scheduled identity through clear, pause, reload and retype', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true, tomorrowPlanInput: 'Write',
      tomorrowFragments: [{ id: 'retained-id', fragment_order: 0, fragment_text: 'Write', normalized_fragment_text: 'Write' }],
      tomorrowSchedules: [{ source_type: 'action', source_id: 'retained-id',
        starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T10:30:00Z' }],
    });
    await renderHook();
    const key = latest.tomorrowActionKeys[0];
    await act(async () => { latest.editTomorrowAction(0, ''); });
    await act(async () => {
      vi.advanceTimersByTime(801);
      await Promise.resolve();
    });
    expect(serviceMocks.replaceTomorrowActions).not.toHaveBeenCalled();
    expect(latest.tomorrowPlanError).toMatch(/Finish editing empty actions or remove/);
    expect(latest.scheduleBlocks[0]).toMatchObject({ source_key: key, source_id: 'retained-id' });
    await act(async () => { await latest.load(); });
    expect(latest.tomorrowActions).toEqual(['']);
    expect(latest.tomorrowActionItems[0]).toMatchObject({ id: key, persistedId: 'retained-id' });
    expect(latest.scheduleBlocks[0].source_key).toBe(key);
    serviceMocks.replaceTomorrowActions.mockImplementationOnce(async ({ rawPlanText, actionTexts, fragmentIds }) => ({
      rawPlanText, fragments: actionTexts, savedFragments: actionTexts.map((text, index) => ({
        id: fragmentIds[index], fragment_order: index, fragment_text: text, normalized_fragment_text: text,
      })),
    }));
    await act(async () => { latest.editTomorrowAction(0, 'Replacement'); });
    await act(async () => { await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions.mock.calls[0][0].fragmentIds).toEqual(['retained-id']);
    expect(latest.tomorrowActions).toEqual(['Replacement']);
    expect(latest.tomorrowActionKeys[0]).toBe(key);
    expect(latest.scheduleBlocks[0]).toMatchObject({ source_key: key, source_id: 'retained-id' });
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

  it('waits for checklist writes and synchronously freezes every edit during completion', async () => {
    const initial = { ...makeState(), scheduleAvailable: true,
      tomorrowFragments: [{ id: '38a3ee64-78ac-4b31-9cd4-df3d93407ce1', fragment_text: 'Write' }],
      followThroughItems: [{ id: 'today-fragment', completion_state: 'unanswered' }] };
    serviceMocks.loadTodayReviewState.mockResolvedValue(initial);
    serviceMocks.completeTodayV2Review.mockResolvedValue({ ...initial.review, completed_at: '2026-09-28T23:00:00Z' });
    await renderHook();
    let resolveWrite;
    serviceMocks.setFollowThroughCompletion.mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
    let write;
    let complete;
    const key = latest.tomorrowActionKeys[0];
    await act(async () => {
      write = latest.saveCommitmentCompletion('today-fragment', 'kept');
      complete = latest.completeReview();
      latest.editTomorrowAction(0, 'Changed');
      latest.removeTomorrowAction(0);
      latest.setTomorrowActions(['Changed']);
      latest.setTomorrowInput('Changed');
      latest.splitTomorrowActions();
      latest.setDesiredDirection('Changed');
      latest.setControllableFocus('Changed');
      latest.setFirstFiveMinutes('Changed');
      latest.updateSchedule(key, { starts_at: '2026-09-29T10:00:00Z' });
      latest.unschedule(key);
      await expect(latest.saveHabitResponse({ id: 'occurrence' }, true)).rejects.toThrow(/Reopen/);
      expect(await latest.completeReview()).toBeNull();
    });
    expect(serviceMocks.completeTodayV2Review).not.toHaveBeenCalled();
    expect(latest.tomorrowActions).toEqual(['Write']);
    expect(latest.scheduleBlocks).toEqual([]);
    expect(latest.desiredDirection).toBe('');
    await act(async () => {
      resolveWrite({ id: 'today-fragment', completion_state: 'kept' });
      await write;
      await complete;
    });
    expect(serviceMocks.completeTodayV2Review).toHaveBeenCalledTimes(1);
    expect(latest.state.followThroughItems[0].completion_state).toBe('kept');
    await act(async () => {
      latest.editTomorrowAction(0, 'Still locked');
      await expect(latest.addManualFollowThrough('Blocked')).rejects.toThrow(/Reopen/);
    });
    expect(latest.tomorrowActions).toEqual(['Write']);
    serviceMocks.reopenTodayV2Review.mockResolvedValue(initial.review);
    await act(async () => {
      await latest.reopenReview();
      latest.editTomorrowAction(0, 'Unlocked');
    });
    expect(latest.tomorrowActions).toEqual(['Unlocked']);
  });

  it('does not complete after a failed checklist save, and permits an explicit successful retry', async () => {
    await renderHook();
    serviceMocks.upsertHabitLog.mockRejectedValueOnce(new Error('habit save failed'));
    await act(async () => {
      await expect(latest.saveHabitResponse({ id: 'occurrence', snapshot_response_type: 'boolean' }, true)).rejects.toThrow('habit save failed');
      await expect(latest.completeReview()).rejects.toThrow('habit save failed');
    });
    expect(serviceMocks.completeTodayV2Review).not.toHaveBeenCalled();
    serviceMocks.upsertHabitLog.mockResolvedValue({ id: 'occurrence', boolean_response: true });
    serviceMocks.completeTodayV2Review.mockResolvedValue({ completed_at: '2026-09-28T23:00:00Z' });
    await act(async () => {
      await latest.saveHabitResponse({ id: 'occurrence', snapshot_response_type: 'boolean' }, true);
      await latest.completeReview();
    });
    expect(serviceMocks.completeTodayV2Review).toHaveBeenCalledTimes(1);
  });

  it('serializes repeated checklist edits and waits for the newest value before completion', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), followThroughItems: [{ id: 'fragment', completion_state: 'unanswered' }],
    });
    await renderHook();
    let resolveFirst;
    serviceMocks.setFollowThroughCompletion.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    serviceMocks.setFollowThroughCompletion.mockImplementationOnce(async () => ({ id: 'fragment', completion_state: 'missed' }));
    serviceMocks.completeTodayV2Review.mockResolvedValue({ completed_at: '2026-09-28T23:00:00Z' });
    let first;
    let second;
    let complete;
    await act(async () => {
      first = latest.saveCommitmentCompletion('fragment', 'kept');
      second = latest.saveCommitmentCompletion('fragment', 'missed');
      complete = latest.completeReview();
    });
    expect(serviceMocks.setFollowThroughCompletion).toHaveBeenCalledTimes(1);
    expect(serviceMocks.completeTodayV2Review).not.toHaveBeenCalled();
    await act(async () => {
      resolveFirst({ id: 'fragment', completion_state: 'kept' });
      await first;
      await second;
      await complete;
    });
    expect(serviceMocks.setFollowThroughCompletion.mock.calls.map((call) => call[1])).toEqual(['kept', 'missed']);
    expect(latest.state.followThroughItems[0].completion_state).toBe('missed');
  });

  it('rejects offline dirty direction and focus flushes without completing', async () => {
    await renderHook();
    await act(async () => {
      latest.setDesiredDirection('Builder');
      latest.setControllableFocus('Focus');
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await act(async () => { await expect(latest.completeReview()).rejects.toThrow(/Offline/); });
      expect(serviceMocks.completeTodayV2Review).not.toHaveBeenCalled();
      expect(JSON.parse(window.localStorage.getItem('today-v2-draft:user-1:2026-09-28'))).toMatchObject({
        desiredDirection: 'Builder', desiredDirectionNeedsSync: true, controllableFocusNeedsSync: true,
      });
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });

  it('drains newer focus edits and ignores a stale direction response from a different review', async () => {
    await renderHook();
    let resolveFocus;
    serviceMocks.updateControllableFocus.mockImplementationOnce(() => new Promise((resolve) => { resolveFocus = resolve; }));
    await act(async () => { latest.setControllableFocus('First'); });
    let first;
    await act(async () => { first = latest.flushAll(); });
    await act(async () => { latest.setControllableFocus('Second'); });
    let drained;
    await act(async () => { drained = latest.flushAll(); });
    await act(async () => { resolveFocus(); await first; await drained; });
    expect(serviceMocks.updateControllableFocus.mock.calls.map((call) => call[1])).toEqual(['First', 'Second']);
    expect(latest.state.review.controllable_focus).toBe('Second');

    let resolveDirection;
    serviceMocks.updateDesiredDirection.mockImplementationOnce(() => new Promise((resolve) => { resolveDirection = resolve; }));
    await act(async () => { latest.setDesiredDirection('Old day'); });
    let pending;
    await act(async () => { pending = latest.saveDesiredDirection(); });
    serviceMocks.loadTodayReviewState.mockResolvedValue(makeState({ todayLocalDate: '2026-09-29', tomorrowLocalDate: '2026-09-30' }));
    await act(async () => { await latest.load(); });
    await act(async () => { resolveDirection(); await pending; });
    expect(latest.state.review.id).toBe('review-2026-09-29');
    expect(latest.state.review.desired_direction).toBe('');
  });

  it('keeps dirty focus edits when an older reload resolves and excludes carryover from editable schedules', async () => {
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true,
      habitDefinitions: [{ id: 'habit', name: 'Habit', schedule_weekdays: [2] }],
      tomorrowSchedules: [{ source_type: 'habit', source_id: 'habit', target_local_date: '2026-09-28',
        starts_at: '2026-09-28T23:30:00Z', ends_at: '2026-09-29T00:30:00Z' }],
    });
    await renderHook();
    expect(latest.scheduleBlocks).toEqual([]);
    let resolveLoad;
    serviceMocks.loadTodayReviewState.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    let loading;
    await act(async () => { loading = latest.load(); });
    await act(async () => { latest.setControllableFocus('Newer local draft'); });
    await act(async () => { resolveLoad(makeState()); await loading; });
    expect(latest.controllableFocus).toBe('Newer local draft');
  });

  it('does not leak drafts or apply an old save response after the authenticated user changes', async () => {
    await renderHook();
    let resolveSave;
    serviceMocks.updateDesiredDirection.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    await act(async () => { latest.setDesiredDirection('First user draft'); });
    let pending;
    await act(async () => { pending = latest.saveDesiredDirection(); });
    const second = makeState();
    second.review = { ...second.review, id: 'review-user-2', desired_direction: 'Second user saved direction' };
    serviceMocks.loadTodayReviewState.mockResolvedValue(second);
    await act(async () => {
      root.render(<HookProbe userId="user-2" onRender={(value) => { latest = value; }} />);
    });
    await act(async () => { resolveSave(); await pending; });
    expect(latest.state.review.id).toBe('review-user-2');
    expect(latest.desiredDirection).toBe('Second user saved direction');
    expect(latest.state.review.desired_direction).toBe('Second user saved direction');
    expect(JSON.parse(window.localStorage.getItem('today-v2-draft:user-2:2026-09-28')).desiredDirection).toBe('Second user saved direction');
  });

  it('ignores old direction/focus failures and finally handlers while new-day saves remain pending', async () => {
    await renderHook();
    let rejectDirection;
    let rejectFocus;
    let resolveDirection;
    let resolveFocus;
    serviceMocks.updateDesiredDirection
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectDirection = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDirection = resolve; }));
    serviceMocks.updateControllableFocus
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFocus = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFocus = resolve; }));
    await act(async () => {
      latest.setDesiredDirection('Old direction');
      latest.setControllableFocus('Old focus');
    });
    let oldPending;
    await act(async () => { oldPending = latest.flushAll(); void oldPending.catch(() => {}); });
    serviceMocks.loadTodayReviewState.mockResolvedValue(makeState({
      todayLocalDate: '2026-09-29', tomorrowLocalDate: '2026-09-30',
    }));
    await act(async () => { await latest.load(); });
    let newPending;
    await act(async () => {
      latest.setDesiredDirection('New direction');
      latest.setControllableFocus('New focus');
      newPending = latest.flushAll();
    });
    expect(serviceMocks.updateDesiredDirection).toHaveBeenCalledTimes(2);
    expect(serviceMocks.updateControllableFocus).toHaveBeenCalledTimes(2);
    await act(async () => {
      rejectDirection(new Error('Old direction failure'));
      rejectFocus(new Error('Old focus failure'));
      await expect(oldPending).rejects.toThrow('Old direction failure');
    });
    expect(latest.desiredDirectionSaveStatus).toBe('saving');
    expect(latest.controllableFocusSaveStatus).toBe('saving');
    let repeated;
    await act(async () => { repeated = latest.flushAll(); });
    expect(serviceMocks.updateDesiredDirection).toHaveBeenCalledTimes(2);
    expect(serviceMocks.updateControllableFocus).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveDirection();
      resolveFocus();
      await newPending;
      await repeated;
    });
    expect(latest.state.review.desired_direction).toBe('New direction');
    expect(latest.state.review.controllable_focus).toBe('New focus');
  });

  it('does not let an older queued plan flush save drafts from the new review context', async () => {
    await renderHook();
    await act(async () => { latest.setTomorrowActions(['Old action']); });
    let resolveOld;
    serviceMocks.replaceTomorrowActions.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    let first;
    let queued;
    await act(async () => { first = latest.saveTomorrowPlan(); queued = latest.saveTomorrowPlan(); });
    serviceMocks.loadTodayReviewState.mockResolvedValue(makeState({
      todayLocalDate: '2026-09-29', tomorrowLocalDate: '2026-09-30',
    }));
    await act(async () => { await latest.load(); latest.setTomorrowActions(['New action']); });
    await act(async () => {
      resolveOld({ rawPlanText: '', savedFragments: [{ id: 'old-fragment', fragment_text: 'Old action' }] });
      await first;
      await queued;
    });
    expect(serviceMocks.replaceTomorrowActions).toHaveBeenCalledTimes(1);
    expect(latest.tomorrowActions).toEqual(['New action']);
    expect(latest.state.tomorrowFragments).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem('today-v2-draft:user-1:2026-09-29')).tomorrowPlanNeedsSync).toBe(true);
  });

  it('does not apply or unlock an older completion after reloading the same review ID', async () => {
    await renderHook();
    let resolveOld;
    let resolveCurrent;
    serviceMocks.completeTodayV2Review
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCurrent = resolve; }));
    let oldPending;
    await act(async () => { oldPending = latest.completeReview(); });
    await act(async () => { await latest.load(); });
    let currentPending;
    await act(async () => { currentPending = latest.completeReview(); });
    expect(serviceMocks.completeTodayV2Review).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveOld({ completed_at: 'old-completion' });
      expect(await oldPending).toBeNull();
    });
    expect(latest.completionSaving).toBe(true);
    expect(latest.state.review.completed_at).toBeNull();
    await act(async () => {
      resolveCurrent({ completed_at: 'current-completion' });
      await currentPending;
    });
    expect(latest.completionSaving).toBe(false);
    expect(latest.state.review.completed_at).toBe('current-completion');
  });

  it('ignores an old reopen response after the same review ID is reloaded', async () => {
    const completed = makeState();
    completed.review.completed_at = 'current-completion';
    completed.routeTarget = '/home';
    serviceMocks.loadTodayReviewState.mockResolvedValue(completed);
    await renderHook();
    let resolveReopen;
    serviceMocks.reopenTodayV2Review.mockImplementationOnce(() => new Promise((resolve) => { resolveReopen = resolve; }));
    let pending;
    await act(async () => { pending = latest.reopenReview(); });
    await act(async () => { await latest.load(); });
    await act(async () => {
      resolveReopen({ completed_at: null });
      await pending;
    });
    expect(latest.isCompleted).toBe(true);
    expect(latest.state.routeTarget).toBe('/home');
  });

  it('loads completed server evidence instead of dirty local drafts, then reopens the saved plan', async () => {
    const completed = {
      ...makeState(), scheduleAvailable: true, tomorrowPlanInput: 'Saved plan',
      tomorrowFragments: [{ id: 'saved-action', fragment_text: 'Saved action' }],
      firstFiveMinutes: 'Saved start',
      tomorrowSchedules: [{ source_type: 'action', source_id: 'saved-action',
        starts_at: '2026-09-29T09:00:00Z', ends_at: '2026-09-29T09:30:00Z' }],
    };
    completed.review = { ...completed.review, desired_direction: 'Saved direction',
      controllable_focus: 'Saved focus', completed_at: '2026-09-28T21:00:00Z' };
    serviceMocks.loadTodayReviewState.mockResolvedValue(completed);
    window.localStorage.setItem('today-v2-draft:user-1:2026-09-28', JSON.stringify({
      desiredDirection: 'Unsaved direction', desiredDirectionNeedsSync: true,
      controllableFocus: 'Unsaved focus', controllableFocusNeedsSync: true,
      tomorrowInput: 'Unsaved plan', tomorrowActions: ['Unsaved action'],
      firstFiveMinutes: 'Unsaved start', tomorrowPlanNeedsSync: true,
      scheduleBlocks: [], scheduleNeedsSync: true,
    }));
    await renderHook();
    expect(latest.desiredDirection).toBe('Saved direction');
    expect(latest.controllableFocus).toBe('Saved focus');
    expect(latest.tomorrowActions).toEqual(['Saved action']);
    expect(latest.tomorrowInput).toBe('Saved plan');
    expect(latest.firstFiveMinutes).toBe('Saved start');
    expect(latest.scheduleBlocks).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(801); await latest.flushAll(); });
    expect(serviceMocks.updateDesiredDirection).not.toHaveBeenCalled();
    expect(serviceMocks.updateControllableFocus).not.toHaveBeenCalled();
    expect(serviceMocks.replaceTomorrowActions).not.toHaveBeenCalled();
    expect(scheduleMocks.replaceSchedule).not.toHaveBeenCalled();
    expect(latest.desiredDirectionSaveStatus).toBe('saved');
    expect(latest.controllableFocusSaveStatus).toBe('saved');
    expect(latest.tomorrowPlanSaveStatus).toBe('saved');
    expect(latest.firstFiveMinutesSaveStatus).toBe('saved');
    expect(latest.scheduleSaveStatus).toBe('saved');
    serviceMocks.reopenTodayV2Review.mockResolvedValue({ ...completed.review, completed_at: null });
    await act(async () => {
      await latest.reopenReview();
      latest.setControllableFocus('New focus');
      await latest.flushAll();
    });
    expect(latest.isCompleted).toBe(false);
    expect(serviceMocks.updateControllableFocus).toHaveBeenCalledWith(completed.review.id, 'New focus');
  });

  it('serializes reopening and resets saving after a reopen failure before retry', async () => {
    const completed = makeState();
    completed.review.completed_at = 'completed';
    serviceMocks.loadTodayReviewState.mockResolvedValue(completed);
    await renderHook();
    let rejectReopen;
    serviceMocks.reopenTodayV2Review.mockImplementationOnce(() => new Promise((_, reject) => { rejectReopen = reject; }));
    let pending;
    await act(async () => { pending = latest.reopenReview(); void pending.catch(() => {}); });
    expect(latest.completionSaving).toBe(true);
    await act(async () => {
      expect(await latest.reopenReview()).toBeNull();
      expect(await latest.completeReview()).toBeNull();
      latest.setDesiredDirection('Cannot edit while reopening');
    });
    expect(serviceMocks.reopenTodayV2Review).toHaveBeenCalledTimes(1);
    expect(latest.desiredDirection).toBe('');
    await act(async () => {
      rejectReopen(new Error('Reopen failed'));
      await expect(pending).rejects.toThrow('Reopen failed');
    });
    expect(latest.isCompleted).toBe(true);
    expect(latest.completionSaving).toBe(false);
    serviceMocks.reopenTodayV2Review.mockResolvedValue({ ...completed.review, completed_at: null });
    await act(async () => { await latest.reopenReview(); });
    expect(latest.isCompleted).toBe(false);
    expect(latest.completionSaving).toBe(false);
  });

  it('ignores stale checklist and manual-item results after the same review ID is reloaded', async () => {
    const initial = makeState();
    const occurrence = { id: 'habit-occurrence', snapshot_response_type: 'boolean', boolean_response: false };
    initial.followThroughItems = [{ id: 'checklist', completion_state: 'not_kept' }];
    initial.habitOccurrences = [occurrence];
    serviceMocks.loadTodayReviewState.mockResolvedValue(initial);
    await renderHook();
    let resolveFragment;
    let resolveHabit;
    let resolveManual;
    serviceMocks.setFollowThroughCompletion.mockImplementationOnce(() => new Promise((resolve) => { resolveFragment = resolve; }));
    serviceMocks.upsertHabitLog.mockImplementationOnce(() => new Promise((resolve) => { resolveHabit = resolve; }));
    serviceMocks.addManualFollowThroughItem.mockImplementationOnce(() => new Promise((resolve) => { resolveManual = resolve; }));
    let writes;
    await act(async () => {
      writes = Promise.all([
        latest.saveCommitmentCompletion('checklist', 'kept'),
        latest.saveHabitResponse(occurrence, true),
        latest.addManualFollowThrough('Stale manual item'),
      ]);
    });
    const completed = { ...initial, review: { ...initial.review, completed_at: 'completed-elsewhere' } };
    serviceMocks.loadTodayReviewState.mockResolvedValue(completed);
    await act(async () => { await latest.load(); });
    await act(async () => {
      resolveFragment({ completion_state: 'kept' });
      resolveHabit({ boolean_response: true });
      resolveManual({ id: 'stale-manual' });
      await writes;
    });
    expect(latest.isCompleted).toBe(true);
    expect(latest.state.followThroughItems).toEqual(initial.followThroughItems);
    expect(latest.state.habitOccurrences).toEqual(initial.habitOccurrences);
  });

  it('does not reload a previous user when their habit save or archive finishes late', async () => {
    await renderHook();
    let resolveSave;
    let resolveArchive;
    serviceMocks.upsertHabitDefinition.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    serviceMocks.archiveHabit.mockImplementationOnce(() => new Promise((resolve) => { resolveArchive = resolve; }));
    let writes;
    await act(async () => {
      writes = Promise.all([
        latest.saveHabitDefinition({ id: 'edited-habit', name: 'Edited' }),
        latest.archiveHabitDefinition('archived-habit'),
      ]);
    });
    const second = makeState();
    second.review = { ...second.review, id: 'second-user-review' };
    serviceMocks.loadTodayReviewState.mockResolvedValue(second);
    await act(async () => {
      root.render(<HookProbe userId="user-2" onRender={(value) => { latest = value; }} />);
    });
    await act(async () => { resolveSave('edited-habit'); resolveArchive(); await writes; });
    expect(serviceMocks.loadTodayReviewState.mock.calls.map((call) => call[0])).toEqual(['user-1', 'user-2']);
    expect(latest.state.review.id).toBe('second-user-review');
  });

  it('prevents an already-open habit editor from saving during or after completion', async () => {
    const initial = makeState();
    initial.tomorrowFragments = [{ id: 'planned-action', fragment_text: 'Write' }];
    initial.habitDefinitions = [{ id: 'habit', name: 'Read', response_type: 'boolean',
      schedule_weekdays: [0, 1, 2, 3, 4, 5, 6], display_order: 0 }];
    initial.habitOccurrences = [{ id: 'occurrence', habit_definition_id: 'habit',
      snapshot_name: 'Read', snapshot_response_type: 'boolean', boolean_response: true,
      answered_at: '2026-09-28T20:00:00Z' }];
    serviceMocks.loadTodayReviewState.mockResolvedValue(initial);
    let resolveCompletion;
    serviceMocks.completeTodayV2Review.mockImplementationOnce(() => new Promise((resolve) => { resolveCompletion = resolve; }));
    await act(async () => { root.render(<TodayV2Page />); });
    const clickButton = async (text) => {
      const button = [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
      expect(button).toBeTruthy();
      await act(async () => { button.click(); });
    };
    await act(async () => { container.querySelector('[aria-label="Habit options for Read"]').click(); });
    await clickButton('Edit');
    let saveHabit = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Save Habit');
    expect(saveHabit.disabled).toBe(false);
    await clickButton("Complete tonight's review");
    expect(serviceMocks.completeTodayV2Review).toHaveBeenCalledTimes(1);
    expect(saveHabit.disabled).toBe(true);
    await act(async () => { saveHabit.click(); });
    expect(serviceMocks.upsertHabitDefinition).not.toHaveBeenCalled();
    await act(async () => { resolveCompletion({ ...initial.review, completed_at: 'completed' }); });
    saveHabit = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Save Habit');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(saveHabit.disabled).toBe(true);
    await act(async () => { saveHabit.click(); });
    expect(serviceMocks.upsertHabitDefinition).not.toHaveBeenCalled();
    expect(pageMocks.navigate).toHaveBeenCalledWith('/home');
  });

  it('does not navigate the new user when an old completion finishes late', async () => {
    const initial = makeState();
    initial.tomorrowFragments = [{ id: 'planned-action', fragment_text: 'Write' }];
    serviceMocks.loadTodayReviewState.mockResolvedValue(initial);
    let resolveCompletion;
    serviceMocks.completeTodayV2Review.mockImplementationOnce(() => new Promise((resolve) => { resolveCompletion = resolve; }));
    await act(async () => { root.render(<TodayV2Page />); });
    const complete = [...container.querySelectorAll('button')].find((node) => node.textContent === "Complete tonight's review");
    await act(async () => { complete.click(); });
    expect(serviceMocks.completeTodayV2Review).toHaveBeenCalledTimes(1);
    const second = makeState();
    second.review = { ...second.review, id: 'second-user-review' };
    serviceMocks.loadTodayReviewState.mockResolvedValue(second);
    pageMocks.userId = 'user-2';
    await act(async () => { root.render(<TodayV2Page />); });
    await act(async () => { resolveCompletion({ ...initial.review, completed_at: 'completed' }); });
    expect(pageMocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Tonight's review is complete.");
  });

  it('retains actual UUIDs through explicit edit/remove/resplit rather than substituting client keys', async () => {
    const firstId = '38a3ee64-78ac-4b31-9cd4-df3d93407ce1';
    const secondId = '64bbfe20-0226-4c24-9f5c-7c1f8d27e885';
    serviceMocks.loadTodayReviewState.mockResolvedValue({
      ...makeState(), scheduleAvailable: true, tomorrowPlanInput: 'Write and Walk',
      tomorrowFragments: [{ id: firstId, fragment_text: 'Write' }, { id: secondId, fragment_text: 'Walk' }],
    });
    serviceMocks.replaceTomorrowActions.mockImplementation(async ({ rawPlanText, actionTexts, fragmentIds }) => ({
      rawPlanText, savedFragments: actionTexts.map((text, index) => ({ id: fragmentIds[index], fragment_text: text })),
    }));
    await renderHook();
    await act(async () => { latest.editTomorrowAction(0, 'Write more'); await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions.mock.calls[0][0].fragmentIds).toEqual([firstId, secondId]);
    await act(async () => { latest.removeTomorrowAction(0); await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions.mock.calls[1][0].fragmentIds).toEqual([secondId]);
    await act(async () => { latest.setTomorrowInput('Walk'); latest.splitTomorrowActions(); await latest.saveTomorrowPlan(); });
    expect(serviceMocks.replaceTomorrowActions.mock.calls[2][0].fragmentIds).toEqual([secondId]);
  });
});
