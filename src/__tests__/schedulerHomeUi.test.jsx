import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), habit: vi.fn(), completion: vi.fn(), navigate: vi.fn(), session: vi.fn(), enabled: true }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../lib/featureFlags', () => ({ get ENABLE_TODAY_V2_SCHEDULER() { return mocks.enabled; } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../v2/services/todayReview', () => ({ loadTodayV2HomeState: mocks.load, upsertHabitLog: mocks.habit, setFollowThroughCompletion: mocks.completion }));
vi.mock('../lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.session } } }));
import HomeV2Page from '../v2/pages/HomeV2Page';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('scheduled Home check-ins', () => {
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

  it('shows persisted times and writes habit responses to the same occurrence', async () => {
    await render();
    expect(container.textContent).toContain('Today\'s habits');
    expect(container.textContent).toContain("Today's calendar");
    expect(container.textContent).not.toContain("Today's actions checklist");
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.querySelector('[data-schedule-key="action:commitment"]').textContent).toContain('Write');
    expect([...container.querySelectorAll('button')].some((button) => ['Kept', 'Not kept'].includes(button.textContent))).toBe(false);
    expect(container.querySelector('[data-scheduler-drag-key]')).toBeNull();
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
    expect(container.textContent).not.toContain("Today's calendar");
    expect(container.textContent).not.toContain("Today's actions checklist");
  });

  it('keeps unscheduled ROI actions visible without reintroducing a checklist', async () => {
    const base = await mocks.load();
    mocks.load.mockResolvedValue({ ...base, todaySchedules: [], scheduleAvailable: false, scheduleDiagnostic: { message: 'Database setup is incomplete' } });
    await render();
    const tray = container.querySelector('[aria-label="Unscheduled items"]');
    expect(tray.textContent).toContain('Write');
    expect(tray.textContent).toContain('Read');
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.textContent).toContain('Database setup is incomplete');
    expect(container.querySelector('[data-scheduler-edit-key="action:commitment"]').disabled).toBe(true);
    expect(container.textContent).not.toContain("Today's actions checklist");
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry scheduling').click());
    expect(mocks.load).toHaveBeenCalledTimes(3);
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open Review & Plan').click());
    expect(mocks.navigate).toHaveBeenCalledWith('/today');
  });

  it('overlays connected Google events without exposing event or ROI editing on Today', async () => {
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
    expect(container.querySelector('[aria-label="Edit Google event Planning meeting"]')).toBeNull();
    expect(container.querySelector('[data-resize-edge]')).toBeNull();
    expect([...container.querySelectorAll('[data-scheduler-edit-key]')].every((button) => button.disabled)).toBe(true);
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
    const habitSection = [...container.querySelectorAll('section')].find((section) => section.textContent.includes("Today's habits"));
    expect(habitSection.textContent).toContain('10:00');
    expect(habitSection.textContent).not.toContain('Continued from previous day');
    await act(async () => [...habitSection.querySelectorAll('button')].find((button) => button.textContent === 'Yes').click());
    expect(mocks.habit).toHaveBeenCalledWith('occurrence', 'boolean', true);
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

  it('clips midnight display and reports unsupported timezone without losing check-ins', async () => {
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
    expect(container.textContent).toContain('Check your date and timezone settings');
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Yes').disabled).toBe(false);
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
    const context = container.querySelector('[aria-label="Current calendar day schedule"]');
    expect(context.textContent).toContain('2026-10-08');
    expect(context.textContent).toContain('Your checklist still belongs to review day 2026-10-07');
    expect(context.textContent).toContain('Late writing');
    expect(context.textContent).toContain('Continued from previous day');
    expect(context.textContent).toContain('Early reading');
    expect(context.textContent).not.toMatch(/11:30|23:30/);
    expect(context.querySelector('button, input')).toBeNull();
    expect(container.textContent).not.toContain("Today's actions checklist");
    expect(container.textContent).toContain('Review day 2026-10-07');
    expect(mocks.completion).not.toHaveBeenCalled();
    const yes = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Yes');
    await act(async () => yes.click());
    expect(mocks.habit).toHaveBeenCalledWith('occurrence', 'boolean', true);
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
    const context = container.querySelector('[aria-label="Current calendar day schedule"]');
    expect(context.textContent).toContain('2026-10-08');
    expect(context.textContent).toContain('Explicit late plan');
    expect(context.textContent).not.toContain('Unselected tomorrow plan');
    expect(context.textContent).toContain('Continued from previous day');
    expect(context.querySelector('button, input')).toBeNull();
    expect(container.textContent).toContain('Review day 2026-10-07');
  });
});
