import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: vi.fn(), getSession: vi.fn(), load: vi.fn(), update: vi.fn(),
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'calendar-user' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children, title }) => <main aria-label={title}>{children}</main> }));
vi.mock('../v2/today/useTodayV2State', () => ({ useTodayV2State: mocks.state }));
vi.mock('../lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Review & Plan calendar integration', () => {
  let root;
  let container;
  let review;
  let fetchMock;
  const response = (payload) => Promise.resolve({ ok: true, json: async () => payload });
  const render = async () => {
    const { default: TodayV2Page } = await import('../v2/pages/TodayV2Page');
    await act(async () => root.render(<TodayV2Page />));
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_ENABLE_TODAY_V2_SCHEDULER', undefined);
    review = {
      loading: false, state: {
        review: {}, tomorrowLocalDate: '2026-10-08', timezoneName: 'UTC',
        followThroughItems: [], habitDefinitions: [], habitOccurrences: [], tomorrowFragments: [],
      },
      desiredDirection: '', tomorrowInput: '', firstFiveMinutes: '', tomorrowActions: [],
      visibleHabits: [], habitDefinitionsById: new Map(),
      schedulerItems: [{ id: 'action:write', key: 'action:write', type: 'action', label: 'Write a chapter' }],
      scheduleBlocks: [], scheduleAvailable: true, scheduleSaveStatus: 'saved',
      completionGate: { canComplete: false, followThroughSatisfied: true, hasTomorrowActions: false },
      load: mocks.load, updateSchedule: mocks.update, unschedule: vi.fn(),
    };
    mocks.state.mockImplementation(() => review);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session', user: { id: 'calendar-user' } } } });
    fetchMock = vi.fn(() => response({ connected: false, configured: true, schemaAvailable: true }));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('shows optional Google controls prominently above the native calendar without an environment flag', async () => {
    await render();
    const headings = [...container.querySelectorAll('h2, h3')].map((node) => node.textContent);
    expect(headings.indexOf('Google Calendar')).toBeLessThan(headings.indexOf('Schedule tomorrow'));
    expect(headings.indexOf('Schedule tomorrow')).toBeGreaterThan(headings.indexOf('6.2 Start focus'));
    expect(container.querySelector('[data-slot-timestamp]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Google events"]')).toBeNull();
    expect(container.textContent).toContain('no Google sign-in needed to use your planner');
    expect([...container.querySelectorAll('button')].find((node) => node.textContent === 'Connect Google Calendar').disabled).toBe(false);
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:write"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save time').click());
    expect(mocks.update).toHaveBeenCalledWith('action:write', expect.objectContaining({
      starts_at: '2026-10-08T09:00:00.000Z', ends_at: '2026-10-08T09:30:00.000Z',
    }));
  });

  it.each(['exercise_movement', null])('displays a saved rename for a habit with seed key %s', async (seedKey) => {
    const definition = {
      id: 'exercise', seed_key: seedKey, name: 'Exercise/Movement',
      response_type: 'boolean', schedule_weekdays: [1], unit: '',
    };
    const occurrence = {
      id: 'exercise-occurrence', habit_definition_id: definition.id,
      snapshot_name: definition.name, snapshot_response_type: 'boolean',
      boolean_response: true, answered_at: '2026-10-07T10:00:00Z',
    };
    review.visibleHabits = [occurrence];
    review.habitDefinitionsById = new Map([[definition.id, definition]]);
    review.saveHabitDefinition = vi.fn(async (draft) => {
      review.habitDefinitionsById = new Map([[definition.id, draft]]);
    });
    await render();
    await act(async () => container.querySelector('[aria-label="Habit options for Exercise/Movement"]').click());
    await act(async () => [...container.querySelectorAll('button')].find((node) => node.textContent === 'Edit').click());
    await act(async () => {
      const input = document.querySelector('[aria-label="Habit name"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Exercise/Movement (plank)');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save Habit').click());
    expect(review.saveHabitDefinition).toHaveBeenCalledWith(expect.objectContaining({
      id: definition.id, name: 'Exercise/Movement (plank)',
    }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-label="Habit options for Exercise/Movement (plank)"]')).not.toBeNull();
    expect([...container.querySelectorAll('p')].some((node) => node.textContent === 'Exercise/Movement (plank)')).toBe(true);
    expect(occurrence).toMatchObject({
      snapshot_name: 'Exercise/Movement', boolean_response: true, answered_at: '2026-10-07T10:00:00Z',
    });
    await act(async () => container.querySelector('[aria-label="Habit options for Exercise/Movement (plank)"]').click());
    await act(async () => [...container.querySelectorAll('button')].find((node) => node.textContent === 'Edit').click());
    expect(document.querySelector('[aria-label="Habit name"]').value).toBe('Exercise/Movement (plank)');
  });

  it.each([false, true])('retains snapshot labels when a definition is missing or the review is completed (%s)', async (completed) => {
    review.visibleHabits = [{
      id: 'exercise-occurrence', habit_definition_id: 'exercise',
      snapshot_name: 'Exercise/Movement', snapshot_response_type: 'boolean',
    }];
    review.isCompleted = completed;
    review.habitDefinitionsById = completed
      ? new Map([['exercise', { id: 'exercise', name: 'Exercise/Movement (plank)' }]])
      : new Map();
    await render();
    expect([...container.querySelectorAll('p')].some((node) => node.textContent === 'Exercise/Movement')).toBe(true);
    expect(container.textContent).not.toContain('Exercise/Movement (plank)');
  });

  it.each([
    ['missing Google configuration', { connected: false, configured: false, schemaAvailable: true }],
    ['missing Google connection schema', { connected: false, configured: true, schemaAvailable: false }],
  ])('keeps the native planner editable with %s', async (_name, status) => {
    fetchMock.mockImplementation(() => response(status));
    await render();
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.querySelector('[data-scheduler-drag-key="action:write"]')).not.toBeNull();
    await act(async () => container.querySelector('[data-scheduler-edit-key="action:write"]').click());
    await act(async () => [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save time').click());
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('action=events'))).toBe(false);
  });

  it('keeps the planner available when Google status fails or there is no Google authorization', async () => {
    fetchMock.mockRejectedValue(new Error('Google is unreachable'));
    await render();
    expect(container.textContent).toContain('Google is unreachable');
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.querySelector('[data-scheduler-edit-key="action:write"]').disabled).toBe(false);
    expect(container.querySelector('[aria-label="Google events"]')).toBeNull();
  });

  it('passes authenticated Google availability into the planning timeline', async () => {
    fetchMock.mockImplementation((url) => {
      const action = new URL(url, 'https://example.invalid').searchParams.get('action');
      if (action === 'status') return response({ connected: true, configured: true, schemaAvailable: true, selectedCalendarIds: ['primary'] });
      if (action === 'calendars') return response({ calendars: [{ id: 'primary', summary: 'Personal' }], selectedCalendarIds: ['primary'] });
      return response({ events: [{ id: 'meeting', title: 'Planning meeting', start: '2026-10-08T11:00:00Z', end: '2026-10-08T12:00:00Z' }] });
    });

    await render();
    expect(container.querySelector('[aria-label="Google events"]').textContent).toContain('Planning meeting');
    const [url, options] = fetchMock.mock.calls.find(([url]) => url.includes('action=events'));
    expect(options.headers.Authorization).toBe(['Bearer', 'test-session'].join(' '));
    expect(new URL(url, 'https://example.invalid').searchParams.get('timeMin')).toBe('2026-10-08T00:00:00.000Z');
    expect(new URL(url, 'https://example.invalid').searchParams.get('timeMax')).toBe('2026-10-10T00:00:00.000Z');
  });

  it('uses civil tomorrow for both native planning and Google before the 4AM review boundary', async () => {
      review.state.planningLocalDate = '2026-10-09';
      review.state.planningSourceLocalDate = '2026-10-08';
      fetchMock.mockImplementation((url) => {
        if (url.includes('action=status')) return response({ connected: true, selectedCalendarIds: ['primary'] });
        if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary' }], selectedCalendarIds: ['primary'] });
        return response({ events: [] });
      });
      await render();
      const [url] = fetchMock.mock.calls.find(([url]) => url.includes('action=events'));
      expect(new URL(url, 'https://example.invalid').searchParams.get('timeMin')).toBe('2026-10-09T00:00:00.000Z');
      await act(async () => container.querySelector('[data-scheduler-edit-key="action:write"]').click());
      await act(async () => [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save time').click());
      expect(mocks.update).toHaveBeenCalledWith('action:write', expect.objectContaining({
        starts_at: '2026-10-09T09:00:00.000Z',
      }));
    });
  it('identifies missing database setup without hiding the calendar or blocking the review', async () => {
    review.scheduleAvailable = false;
    review.scheduleDiagnostic = { code: '42P01', message: 'relation does not exist' };
    await render();
    expect(container.textContent).toContain('Calendar database setup is incomplete');
    expect(container.textContent).toContain('20261011_today_v2_day_schedule.sql');
    expect(container.textContent).toContain('You can still save your actions and complete your review');
    expect(container.querySelectorAll('[data-slot-timestamp]')).toHaveLength(96);
    expect(container.querySelector('[data-scheduler-edit-key="action:write"]').disabled).toBe(true);
    expect(container.querySelector('[data-scheduler-drag-key]')).toBeNull();
    await act(async () => [...container.querySelectorAll('button')].find((node) => node.textContent === 'Retry scheduling').click());
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('6.1 Identity Alignment');
  });

  it('preserves completed schedules as read-only until the review is reopened', async () => {
    review.isCompleted = true;
    review.scheduleBlocks = [{
      source_key: 'action:write', source_id: 'write', starts_at: '2026-10-08T09:00:00Z', ends_at: '2026-10-08T09:30:00Z',
    }];
    await render();
    expect(container.querySelector('[data-schedule-key="action:write"]').textContent).toContain('09:00');
    expect(container.querySelector('[data-scheduler-edit-key="action:write"]').disabled).toBe(true);
    expect(container.textContent).toContain("Tonight's review is complete.");
  });

  it('does not allow review completion while a Google event write is pending', async () => {
    review.completionGate = { ...review.completionGate, canComplete: true };
    review.completeReview = vi.fn().mockResolvedValue({});
    let resolveCreate;
    fetchMock.mockImplementation((url) => {
      if (url.includes('action=status')) return response({ connected: true, canWrite: true, selectedCalendarIds: ['primary'] });
      if (url.includes('action=calendars')) return response({ calendars: [{ id: 'primary', accessRole: 'owner', summary: 'Personal' }], selectedCalendarIds: ['primary'] });
      if (url.includes('action=create')) return new Promise((resolve) => { resolveCreate = resolve; });
      return response({ events: [] });
    });
    await render();
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New Google event').click());
    await act(async () => {
      const title = document.querySelector('[aria-label="Event title"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, 'Google meeting');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const complete = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Saving Google event…');
    expect(complete.disabled).toBe(true);
    await act(async () => complete.click());
    expect(review.completeReview).not.toHaveBeenCalled();
    await act(async () => resolveCreate(await response({ event: { eventId: 'new' } })));
    const resumedComplete = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === "Complete tonight's review");
    expect(resumedComplete.disabled).toBe(false);
    await act(async () => resumedComplete.click());
    expect(review.completeReview).toHaveBeenCalledOnce();
  });

  it('retains an explicit false emergency rollback without hiding the rest of Review & Plan', async () => {
    vi.stubEnv('VITE_ENABLE_TODAY_V2_SCHEDULER', 'false');
    await render();
    expect(container.textContent).not.toContain('Google Calendar');
    expect(container.textContent).not.toContain('Schedule tomorrow');
    expect(container.textContent).toContain('6.1 Identity Alignment');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
