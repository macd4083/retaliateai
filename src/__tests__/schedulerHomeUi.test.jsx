import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), habit: vi.fn(), completion: vi.fn(), navigate: vi.fn(), session: vi.fn(), schedule: vi.fn(), enabled: true }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../lib/featureFlags', () => ({ get ENABLE_TODAY_V2_SCHEDULER() { return mocks.enabled; } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../v2/services/todayReview', () => ({ loadTodayV2HomeState: mocks.load, upsertHabitLog: mocks.habit, setFollowThroughCompletion: mocks.completion }));
vi.mock('../lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.session } } }));
vi.mock('../v2/services/scheduling', () => ({
  updateDaySchedule: mocks.schedule,
  isMissingScheduleSchema: (error) => error?.code === 'PGRST202',
}));
import HomeV2Page from '../v2/pages/HomeV2Page';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('scheduled Home calendar', () => {
  let root;
  let container;
  const habit = { id: 'occurrence', habit_definition_id: 'definition', snapshot_name: 'Read', snapshot_response_type: 'boolean', boolean_response: null, answered_at: null };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    mocks.session.mockResolvedValue({ data: { session: { access_token: 'test-session', user: { id: 'user' } } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connected: false, configured: true, schemaAvailable: true }) }));
    mocks.enabled = true;
    mocks.schedule.mockResolvedValue([]);
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
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const render = async () => act(async () => root.render(<HomeV2Page />));

  it('shows persisted action and habit times without exposing habit check-ins', async () => {
    await render();
    expect(container.textContent).toContain("Today's calendar");
    expect(container.textContent).not.toContain("Today's actions checklist");
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.querySelector('[data-schedule-key="action:commitment"]').textContent).toContain('Write');
    expect(container.querySelector('[data-schedule-key="habit:definition"]').textContent).toContain('10:00');
    expect([...container.querySelectorAll('button')].some((button) => ['Kept', 'Not kept'].includes(button.textContent))).toBe(false);
    expect([...container.querySelectorAll('button')].some((button) => ['Yes', 'No'].includes(button.textContent))).toBe(false);
    expect(container.querySelector('[data-scheduler-drag-key]')).not.toBeNull();
    expect(container.textContent).toMatch(/9:00|09:00/);
    expect(container.textContent).toMatch(/10:00/);
    expect(container.textContent).not.toContain('Habit momentum');
    expect(mocks.habit).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('removes only the Today tray while retaining scheduled block editing, movement, and resizing', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      followThroughItems: [...base.followThroughItems, { id: 'unscheduled', normalized_fragment_text: 'Unscheduled action' }],
    });
    await render();
    expect(container.querySelector('[aria-label="Unscheduled items"]')).toBeNull();
    expect(container.textContent).not.toContain('Unscheduled action');
    expect(container.textContent).not.toContain('Unscheduled (');
    expect(container.textContent).not.toContain('Drag actions and habits into your day');
    expect(container.querySelector('[data-scheduler-drag-key="action:commitment"]')).not.toBeNull();
    expect(container.querySelector('[data-resize-edge]')).not.toBeNull();
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:commitment"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save time').click());
    expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({
      targetLocalDate: '2026-10-07', sourceId: 'commitment',
      startsAt: '2026-10-07T09:00:00.000Z', endsAt: '2026-10-07T09:30:00.000Z',
    }));
  });

  it.each([
    [false, true, 'Exercise/Movement (plank)'],
    [true, true, 'Exercise/Movement'],
    [false, false, 'Exercise/Movement'],
  ])('labels calendar habits using saved names unless completed (%s) or missing definitions (%s)', async (completed, hasDefinition, expected) => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      review: { completed_at: completed ? '2026-10-07T12:00:00Z' : null },
      habitOccurrences: [{ ...habit, snapshot_name: 'Exercise/Movement' }],
      habitDefinitions: hasDefinition ? [{ id: 'definition', name: 'Exercise/Movement (plank)' }] : [],
    });
    await render();
    const block = container.querySelector('[data-schedule-key="habit:definition"]');
    expect(block.textContent).toContain(expected);
    if (expected === 'Exercise/Movement') expect(block.textContent).not.toContain('(plank)');
  });

  it('hides scheduler-only display when the feature flag is off', async () => {
    mocks.enabled = false;
    await render();
    expect(container.textContent).not.toContain('Today\'s habits');
    expect(container.textContent).not.toContain('Habit momentum');
    expect(container.textContent).not.toMatch(/9:00|09:00/);
    expect(container.textContent).not.toContain("Today's calendar");
    expect(container.textContent).not.toContain("Today's actions checklist");
  });

  it('edits and unschedules today timings using persisted identities without changing ROI completion', async () => {
    mocks.schedule.mockResolvedValueOnce([
      { id: 'action-block', source_type: 'action', source_id: 'commitment', target_local_date: '2026-10-07', starts_at: '2026-10-07T09:00:00Z', ends_at: '2026-10-07T09:30:00Z' },
      { id: 'habit-block', source_type: 'habit', source_id: 'definition', target_local_date: '2026-10-07', starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T10:30:00Z' },
    ]).mockResolvedValueOnce([
      { id: 'habit-block', source_type: 'habit', source_id: 'definition', target_local_date: '2026-10-07', starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T10:30:00Z' },
    ]);
    await render();
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:commitment"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save time').click());
    expect(mocks.schedule).toHaveBeenCalledWith({
      userId: 'user',
      targetLocalDate: '2026-10-07', timezoneName: 'UTC', sourceType: 'action', sourceId: 'commitment',
      startsAt: '2026-10-07T09:00:00.000Z', endsAt: '2026-10-07T09:30:00.000Z',
    });
    expect(container.querySelector('[data-schedule-key="habit:definition"]')).not.toBeNull();
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:commitment"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Unschedule').click());
    expect(mocks.schedule).toHaveBeenLastCalledWith({
      userId: 'user',
      targetLocalDate: '2026-10-07', timezoneName: 'UTC', sourceType: 'action', sourceId: 'commitment', startsAt: null, endsAt: null,
    });
    expect(container.querySelector('[data-schedule-key="action:commitment"]')).toBeNull();
    expect(container.querySelector('[aria-label="Unscheduled items"]')).toBeNull();
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('reports missing editing migration without discarding displayed schedules', async () => {
    mocks.schedule.mockRejectedValue({ code: 'PGRST202', message: 'RPC missing' });
    await render();
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:commitment"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save time').click());
    expect(container.textContent).toContain('20261011_today_v2_day_schedule.sql');
    expect(container.querySelector('[data-schedule-key="action:commitment"]')).not.toBeNull();
  });

  it('uses the current civil day sources before 4AM without reopening the completed prior review', async () => {
    vi.setSystemTime(new Date('2026-10-08T01:00:00Z'));
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base, review: { completed_at: '2026-10-07T22:00:00Z' },
      civilScheduleLocalDate: '2026-10-08',
      civilSchedules: [{ id: 'current-block', target_local_date: '2026-10-08', commitment_fragment_id: 'current-action',
        starts_at: '2026-10-08T11:00:00Z', ends_at: '2026-10-08T11:30:00Z' }],
      civilFollowThroughItems: [{ id: 'current-action', normalized_fragment_text: 'Today action' }],
      civilHabitOccurrences: [], civilReview: { completed_at: null },
    });
    await render();
    expect(container.querySelector('[aria-label^="24-hour timeline"]').getAttribute('aria-label')).toContain('2026-10-08');
    expect(container.querySelector('[data-scheduler-edit-key="action:commitment"]')).toBeNull();
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:current-action"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save time').click());
    expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({ targetLocalDate: '2026-10-08', sourceId: 'current-action' }));
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('keeps completed target-day schedule evidence locked', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({ ...base, civilReview: { completed_at: '2026-10-07T22:00:00Z' } });
    await render();
    expect(container.querySelector('[data-scheduler-edit-key="action:commitment"]').disabled).toBe(true);
    expect(container.querySelector('[data-scheduler-drag-key]')).toBeNull();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('shows the late-night review contract without shifting the editable civil-day calendar', async () => {
    vi.setSystemTime(new Date('2026-10-08T02:00:00Z'));
    const base = await mocks.load();
    const action = { id: 'current-action', normalized_fragment_text: 'Write today' };
    mocks.load.mockResolvedValue({
      ...base, review: { completed_at: '2026-10-08T02:00:00Z' },
      planningSourceLocalDate: '2026-10-07', planningLocalDate: '2026-10-08',
      tomorrowLocalDate: '2026-10-08', tomorrowFragments: [action],
      firstFiveMinutes: 'Open notes', planningSchedules: [],
      civilScheduleLocalDate: '2026-10-08', civilSchedules: [],
      civilFollowThroughItems: [action], civilHabitOccurrences: [], civilReview: { completed_at: null },
    });
    await render();
    expect(container.textContent).toContain('Planning date 2026-10-08');
    expect(container.textContent).toContain('Start with: Open notes');
    expect(container.querySelector('[aria-label^="24-hour timeline"]').getAttribute('aria-label')).toContain('2026-10-08');
    expect(container.querySelector('[data-scheduler-edit-key="action:current-action"]').disabled).toBe(false);
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('refreshes the displayed calendar at civil midnight instead of waiting for the review boundary', async () => {
    await render();
    const before = mocks.load.mock.calls.length;
    vi.setSystemTime(new Date('2026-10-08T00:01:00Z'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.load.mock.calls.length).toBeGreaterThan(before);
  });

  it.each([
    { timezone: 'UTC', beforeBoundary: '2026-10-08T03:59:00Z', atBoundary: '2026-10-08T04:00:00Z' },
    { timezone: 'America/New_York', beforeBoundary: '2026-10-08T07:59:00Z', atBoundary: '2026-10-08T08:00:00Z' },
  ])('refreshes review ownership at 4AM in $timezone even when the civil calendar date stays unchanged', async ({ timezone, beforeBoundary, atBoundary }) => {
    const base = await mocks.load();
    vi.setSystemTime(new Date(beforeBoundary));
    mocks.load.mockResolvedValue({
      ...base, timezoneName: timezone, dayBoundaryHour: 4,
      civilScheduleLocalDate: '2026-10-08', civilSchedules: [], civilHabitOccurrences: [],
    });
    await render();
    const before = mocks.load.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.load).toHaveBeenCalledTimes(before);
    expect(container.textContent).toContain('Review day 2026-10-07');
    vi.setSystemTime(new Date(atBoundary));
    mocks.load.mockResolvedValue({ ...base, timezoneName: timezone, dayBoundaryHour: 4, todayLocalDate: '2026-10-08' });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.load).toHaveBeenCalledTimes(before + 1);
    expect(container.textContent).toContain('Review day 2026-10-08');
  });

  it('does not replace the removed tray with an unscheduled list when scheduling is unavailable', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({ ...base, todaySchedules: [], scheduleAvailable: false, scheduleDiagnostic: { message: 'Database setup is incomplete' } });
    await render();
    expect(container.querySelector('[aria-label="Unscheduled items"]')).toBeNull();
    expect(container.textContent).not.toContain('Write');
    expect(container.textContent).not.toContain('Read');
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.textContent).toContain('Database setup is incomplete');
    expect(container.querySelector('[data-scheduler-edit-key="action:commitment"]')).toBeNull();
    expect(container.textContent).not.toContain("Today's actions checklist");
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry scheduling').click());
    expect(mocks.load).toHaveBeenCalledTimes(3);
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open Review & Plan').click());
    expect(mocks.navigate).toHaveBeenCalledWith('/today');
  });

  it('overlays connected Google events with the same editing controls but no ROI completion checklist', async () => {
    fetch.mockImplementation(async (url) => ({
      ok: true,
      json: async () => {
        if (url.includes('action=status')) return { connected: true, canWrite: true, selectedCalendarIds: ['primary'] };
        if (url.includes('action=calendars')) return { calendars: [{ id: 'primary', accessRole: 'owner', summary: 'Personal' }], selectedCalendarIds: ['primary'] };
        return { events: [{ id: 'meeting', calendarId: 'primary', eventId: 'meeting', editable: true, title: 'Planning meeting', start: '2026-10-07T11:00:00Z', end: '2026-10-07T12:00:00Z' }] };
      },
    }));
    await render();
    expect(container.querySelector('[aria-label="Google events"]').textContent).toContain('Planning meeting');
    expect(container.querySelector('[aria-label="Edit Google event Planning meeting"]')).not.toBeNull();
    expect(container.querySelector('[data-resize-edge]')).not.toBeNull();
    expect([...container.querySelectorAll('[data-scheduler-edit-key]')].every((button) => !button.disabled)).toBe(true);
    await act(async () => container.querySelector('[aria-label="Edit Google event Planning meeting"]').click());
    expect(document.querySelector('[aria-label="Event title"]').value).toBe('Planning meeting');
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it('keeps completed scheduled-habit evidence using an occurrence snapshot after its definition is archived', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      review: { completed_at: '2026-10-07T22:00:00Z' },
      habitDefinitions: [],
      tomorrowSchedules: [{ id: 'preserved', habit_definition_id: 'definition', starts_at: '2026-10-08T11:00:00Z', ends_at: '2026-10-08T11:30:00Z' }],
    });
    await render();
    expect(container.textContent).toContain('Read · Habit');
    expect(container.textContent).toContain('11:00');
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it('uses planning schedules for civil tomorrow before the 4AM review boundary', async () => {
    const base = await mocks.load();
    vi.setSystemTime(new Date('2026-10-08T03:59:00Z'));
    mocks.load.mockResolvedValue({
      ...base,
      review: { completed_at: '2026-10-07T22:00:00Z' },
      civilScheduleLocalDate: '2026-10-08', civilSchedules: [],
      tomorrowLocalDate: '2026-10-08', planningLocalDate: '2026-10-09',
      tomorrowSchedules: [{ id: 'old-plan', habit_definition_id: 'definition', starts_at: '2026-10-08T11:00:00Z', ends_at: '2026-10-08T11:30:00Z' }],
      planningSchedules: [{ id: 'new-plan', habit_definition_id: 'definition', starts_at: '2026-10-09T12:00:00Z', ends_at: '2026-10-09T12:30:00Z' }],
    });
    await render();
    const plan = [...container.querySelectorAll('h2')].find((heading) => heading.textContent === "Tomorrow you said you'd prove it by:").closest('section');
    expect(plan.textContent).toContain('Read · Habit');
    expect(plan.textContent).toContain('12:00');
    expect(plan.textContent).not.toContain('11:00');
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it('shows clipped previous-day carryover read-only without binding it to today habit check-ins', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      todaySchedules: [
        { id: 'carryover', habit_definition_id: 'definition', target_local_date: '2026-10-06', label: 'Read yesterday', starts_at: '2026-10-06T23:30:00Z', ends_at: '2026-10-07T00:30:00Z' },
        { id: 'current', habit_definition_id: 'definition', target_local_date: '2026-10-07', starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T10:30:00Z' },
        { id: 'old', source_type: 'habit', habit_definition_id: 'old-definition', label: 'Already ended', starts_at: '2026-10-06T23:00:00Z', ends_at: '2026-10-07T00:00:00Z' },
      ],
    });
    await render();
    const carryover = container.querySelector('[data-context-schedule-id="carryover"]');
    expect(carryover.textContent).toContain('Read yesterday');
    expect(carryover.textContent).toContain('Continued from previous day');
    expect(carryover.textContent).toContain('Previous-day · 2026-10-06 · read-only');
    expect(carryover.textContent).not.toMatch(/11:30|23:30/);
    expect(carryover.querySelector('button, input')).toBeNull();
    expect(container.textContent).not.toContain('Already ended');
    const currentHabit = container.querySelector('[data-schedule-key="habit:definition"]');
    expect(currentHabit.textContent).toContain('10:00');
    expect(currentHabit.textContent).not.toContain('Continued from previous day');
    expect(container.textContent).not.toContain("Today's habits");
    expect(container.textContent).not.toContain('Habit momentum');
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it('keeps tomorrow carryover separate from current-day habit evidence and excludes future blocks', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      review: { completed_at: '2026-10-07T22:00:00Z' },
      tomorrowSchedules: [
        { id: 'carryover', habit_definition_id: 'definition', target_local_date: '2026-10-07', label: 'Late reading', starts_at: '2026-10-07T23:30:00Z', ends_at: '2026-10-08T00:30:00Z' },
        { id: 'future', source_type: 'habit', habit_definition_id: 'future-definition', starts_at: '2026-10-09T00:00:00Z', ends_at: '2026-10-09T00:30:00Z' },
      ],
    });
    await render();
    expect(container.querySelector('[data-carryover-schedule-id="carryover"]').textContent).toContain('Late reading');
    expect(container.textContent).not.toContain('Read · Habit');
    expect(container.textContent).not.toContain('Scheduled habit');
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it('reports unsupported timezone without exposing habit check-ins', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      todaySchedules: [{ commitment_fragment_id: 'commitment', starts_at: '2026-10-07T23:45:00Z', ends_at: '2026-10-08T00:15:00Z' }],
    });
    await render();
    expect(container.textContent).toContain('(+1 day) · Continues tomorrow');
    expect(container.textContent).not.toMatch(/12:15|00:15/);
    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.load.mockResolvedValue({ ...base, timezoneName: 'Unsupported/Nowhere' });
    await render();
    expect(container.textContent).toContain('Timeline unavailable for this date or timezone');
    expect([...container.querySelectorAll('button')].some((button) => ['Yes', 'No'].includes(button.textContent))).toBe(false);
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it.each([
    { timezone: 'UTC', now: '2026-10-08T01:00:00Z', start: '2026-10-07T23:30:00Z', end: '2026-10-08T01:30:00Z', nextStart: '2026-10-08T02:00:00Z', nextEnd: '2026-10-08T02:30:00Z' },
    { timezone: 'America/New_York', now: '2026-10-08T05:00:00Z', start: '2026-10-08T03:30:00Z', end: '2026-10-08T05:30:00Z', nextStart: '2026-10-08T06:00:00Z', nextEnd: '2026-10-08T06:30:00Z' },
  ])('separates civil-day carryover at 01:00 in $timezone from review-day check-in ownership', async ({ timezone, now, start, end, nextStart, nextEnd }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      timezoneName: timezone,
      tomorrowLocalDate: '2026-10-08',
      tomorrowSchedules: [
        { id: 'civil-carryover', commitment_fragment_id: 'commitment', target_local_date: '2026-10-07', label: 'Late writing', starts_at: start, ends_at: end },
        { id: 'civil-habit', habit_definition_id: 'definition', target_local_date: '2026-10-08', label: 'Early reading', starts_at: nextStart, ends_at: nextEnd },
      ],
    });
    await render();
    const context = container.querySelector('[aria-labelledby="tomorrow-scheduler-title"]');
    expect(context.textContent).toContain('2026-10-08');
    expect(container.textContent).toContain('Your checklist still belongs to review day 2026-10-07');
    expect(context.textContent).toContain('Late writing');
    expect(context.textContent).toContain('Continued from previous day');
    expect(context.textContent).toContain('Early reading');
    expect(context.textContent).not.toMatch(/11:30|23:30/);
    expect(context.querySelector('[data-context-schedule-id="civil-carryover"]').querySelector('button, input')).toBeNull();
    expect(container.textContent).not.toContain("Today's actions checklist");
    expect(container.textContent).toContain('Review day 2026-10-07');
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Today's habits");
    expect(container.textContent).not.toContain('Habit momentum');
    expect([...container.querySelectorAll('button')].some((button) => ['Yes', 'No'].includes(button.textContent))).toBe(false);
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it('uses the stored timezone civil date rather than the UTC or machine date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z'));
    const base = await mocks.load();
    mocks.load.mockResolvedValue({ ...base, timezoneName: 'America/New_York' });
    await render();
    expect(container.querySelector('[aria-label="Current calendar day schedule"]')).toBeNull();
    expect(container.textContent).toContain('Review day 2026-10-07');
  });

  it('shows the actual +2 civil-date offset for 24-hour DST carryover without adding check-ins', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      todayLocalDate: '2026-03-09',
      timezoneName: 'America/New_York',
      todaySchedules: [{ id: 'dst-carryover', commitment_fragment_id: 'commitment', target_local_date: '2026-03-07', label: 'Long DST plan', starts_at: '2026-03-08T04:45:00Z', ends_at: '2026-03-09T04:45:00Z' }],
    });
    await render();
    const context = container.querySelector('[data-context-schedule-id="dst-carryover"]');
    expect(context.textContent).toContain('(+2 days)');
    expect(context.textContent).not.toContain('(+1 day)');
    expect(context.textContent).not.toMatch(/11:45|23:45/);
    expect(context.textContent).toContain('Continued from previous day');
    expect(context.querySelector('button, input')).toBeNull();
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.habit).not.toHaveBeenCalled();
  });

  it('uses explicit service civil schedule fields without changing review-day responses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T23:00:00Z'));
    const base = await mocks.load();
    mocks.load.mockResolvedValue({
      ...base,
      civilScheduleLocalDate: '2026-10-08',
      civilSchedules: [{ id: 'explicit-carryover', commitment_fragment_id: 'commitment', target_local_date: '2026-10-07', label: 'Explicit late plan', starts_at: '2026-10-07T23:30:00Z', ends_at: '2026-10-08T00:30:00Z' }],
      tomorrowSchedules: [{ id: 'unused-context', label: 'Unselected tomorrow plan', starts_at: '2026-10-08T01:00:00Z', ends_at: '2026-10-08T01:30:00Z' }],
    });
    await render();
    const context = container.querySelector('[aria-labelledby="tomorrow-scheduler-title"]');
    expect(context.textContent).toContain('2026-10-08');
    expect(context.textContent).toContain('Explicit late plan');
    expect(context.textContent).not.toContain('Unselected tomorrow plan');
    expect(context.textContent).toContain('Continued from previous day');
    expect(context.querySelector('[data-context-schedule-id="explicit-carryover"]').querySelector('button, input')).toBeNull();
    expect(container.textContent).toContain('Review day 2026-10-07');
  });
});
