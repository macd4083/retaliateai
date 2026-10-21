import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({
  tables: {},
  from: vi.fn(),
  rpc: vi.fn(),
  session: vi.fn(),
}));

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: (...args) => persistence.from(...args),
    rpc: (...args) => persistence.rpc(...args),
    auth: { getSession: (...args) => persistence.session(...args) },
  },
}));
vi.mock('../lib/featureFlags', () => ({ ENABLE_TODAY_V2_SCHEDULER: true }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'flow-user' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/today', search: '', hash: '', state: null }) }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <main>{children}</main> }));

import HomeV2Page from '../v2/pages/HomeV2Page';
import TodayV2Page from '../v2/pages/TodayV2Page';
import { completeTodayV2Review, replaceTomorrowActions } from '../v2/services/todayReview';
import { replaceSchedule } from '../v2/services/scheduling';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeQuery(table) {
  const filters = [];
  const orders = [];
  let limit = null;
  let upserted = null;
  let updated = null;

  const matchingRows = () => {
    let rows = [...(persistence.tables[table] || [])].filter((row) => filters.every(({ column, operator, value }) => {
      if (operator === 'eq') return row[column] === value;
      if (operator === 'gte') return row[column] >= value;
      if (operator === 'lte') return row[column] <= value;
      if (operator === 'lt') return row[column] < value;
      if (operator === 'neq') return row[column] !== value;
      if (operator === 'not-null') return row[column] !== null;
      return true;
    }));
    for (const { column, ascending } of orders) {
      rows.sort((left, right) => {
        const result = String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
        return ascending ? result : -result;
      });
    }
    return limit === null ? rows : rows.slice(0, limit);
  };
  const persistWrite = () => {
    const rows = persistence.tables[table] || (persistence.tables[table] = []);
    if (upserted) {
      const existing = rows.find((row) => row.user_id === upserted.user_id && row.local_date === upserted.local_date);
      if (existing) return Object.assign(existing, upserted);
      const created = { id: `${table}-${rows.length}`, completed_at: null, ...upserted };
      rows.push(created);
      return created;
    }
    if (updated) {
      const row = rows.find((candidate) => filters.every(({ column, operator, value }) => (
        operator !== 'eq' || candidate[column] === value
      )));
      if (row) Object.assign(row, updated);
    }
    return matchingRows()[0] || null;
  };
  const query = {
    select() { return this; },
    eq(column, value) { filters.push({ column, operator: 'eq', value }); return this; },
    gte(column, value) { filters.push({ column, operator: 'gte', value }); return this; },
    lte(column, value) { filters.push({ column, operator: 'lte', value }); return this; },
    lt(column, value) { filters.push({ column, operator: 'lt', value }); return this; },
    neq(column, value) { filters.push({ column, operator: 'neq', value }); return this; },
    not(column, operator, value) {
      if (operator === 'is' && value === null) filters.push({ column, operator: 'not-null' });
      return this;
    },
    order(column, { ascending = true } = {}) { orders.push({ column, ascending }); return this; },
    limit(value) { limit = value; return this; },
    upsert(row) { upserted = row; return this; },
    update(patch) { updated = patch; return this; },
    async maybeSingle() { return { data: upserted || updated ? persistWrite() : matchingRows()[0] || null, error: null }; },
    async single() { return { data: persistWrite(), error: null }; },
    then(resolve, reject) { return Promise.resolve({ data: matchingRows(), error: null }).then(resolve, reject); },
  };
  return query;
}

describe('completed review hands tomorrow’s plan from Home to the next morning', () => {
  let container;
  let root;
  const actionId = '1cfde77d-dcaa-4c7c-a409-f9ef5e70e321';
  const habitId = '2cfde77d-dcaa-4c7c-a409-f9ef5e70e321';
  const actionKey = `action:${actionId}`;
  const habitKey = `habit:${habitId}`;
  const timelineDate = (scope) => scope.querySelector('[aria-label^="24-hour timeline"]').getAttribute('aria-label');
  const blockText = (scope, key) => (scope.querySelector(`[data-schedule-key="${key}"]`)?.textContent || '').replace('⠿', '');
  const render = async (element) => {
    await act(async () => root.render(element));
    await act(async () => { await Promise.resolve(); });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T21:30:00.000Z'));
    persistence.tables = {
      today_v2_daily_reviews: [{
        id: 'review-oct-11', user_id: 'flow-user', local_date: '2026-10-11',
        timezone_name: 'UTC', desired_direction: 'Build consistency', controllable_focus: null,
        completed_at: null, updated_at: '2026-10-11T21:30:00.000Z',
      }],
      today_v2_habit_definitions: [{
        id: habitId, user_id: 'flow-user', name: 'Read', response_type: 'boolean', unit: '',
        schedule_weekdays: [0, 1, 2, 3, 4, 5, 6], display_order: 0, is_archived: false,
        planning_mode: 'manual', schedule_times: {},
      }],
      today_v2_habit_occurrences: ['2026-10-11', '2026-10-12'].map((localDate) => ({
        id: `read-${localDate}`, user_id: 'flow-user', habit_definition_id: habitId,
        local_date: localDate, timezone_name: 'UTC', snapshot_name: 'Read',
        snapshot_response_type: 'boolean', snapshot_display_order: 0,
      })),
      today_v2_plan_inputs: [],
      today_v2_commitment_fragments: [],
      today_v2_schedule_blocks: [],
    };
    persistence.from.mockImplementation(makeQuery);
    persistence.session.mockResolvedValue({ data: { session: { access_token: 'test-session', user: { id: 'flow-user' } } } });
    persistence.rpc.mockImplementation(async (name, args) => {
      if (name === 'today_v2_replace_plan_stable') {
        const rows = args.p_fragment_texts.map((fragment_text, index) => ({
          id: args.p_fragment_ids[index] || actionId, user_id: 'flow-user',
          target_local_date: args.p_target_local_date, source_local_date: args.p_source_local_date,
          fragment_order: index, fragment_text, normalized_fragment_text: fragment_text, completion_state: 'unanswered',
        }));
        persistence.tables.today_v2_plan_inputs = [{
          id: 'plan-oct-12', user_id: 'flow-user', target_local_date: args.p_target_local_date,
          source_local_date: args.p_source_local_date, timezone_name: args.p_timezone_name,
          raw_plan_text: args.p_raw_plan_text, first_five_minutes: args.p_first_five_minutes,
        }];
        persistence.tables.today_v2_commitment_fragments = rows;
        return { data: rows, error: null };
      }
      if (name === 'today_v2_replace_schedule_checked') {
        const rows = args.p_blocks.map((block, index) => ({
          id: `schedule-${index}`, user_id: 'flow-user', target_local_date: args.p_target_local_date,
          timezone_name: args.p_timezone_name, ...block,
        }));
        persistence.tables.today_v2_schedule_blocks = rows;
        return { data: rows, error: null };
      }
      return { data: null, error: null };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: false, configured: true, schemaAvailable: true }),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows Oct 12’s plan on Home at 22:00 Oct 11 and the same plan on Today and in Part 1 at 09:00 Oct 12', async () => {
    const plan = await replaceTomorrowActions({
      targetLocalDate: '2026-10-12', sourceLocalDate: '2026-10-11', timezoneName: 'UTC',
      rawPlanText: 'Write report', actionTexts: ['Write report'], firstFiveMinutes: 'Open the draft',
      scheduleAvailable: true, userId: 'flow-user', explicitActions: true,
    });
    await replaceSchedule({
      targetLocalDate: '2026-10-12', timezoneName: 'UTC',
      blocks: [
        { source_type: 'action', source_id: plan.savedFragments[0].id, starts_at: '2026-10-12T09:00:00.000Z', ends_at: '2026-10-12T09:30:00.000Z' },
        { source_type: 'habit', source_id: habitId, starts_at: '2026-10-12T10:00:00.000Z', ends_at: '2026-10-12T10:30:00.000Z' },
      ],
    });
    vi.setSystemTime(new Date('2026-10-11T22:00:00.000Z'));
    await completeTodayV2Review('review-oct-11');

    await render(<HomeV2Page />);
    const tomorrow = container.querySelector('[data-home-calendar="tomorrow"]');
    expect(tomorrow).not.toBeNull();
    expect(tomorrow.querySelector('h3').textContent).toBe('Tomorrow · 2026-10-12');
    expect(timelineDate(tomorrow)).toContain('2026-10-12');
    expect(tomorrow.textContent).toContain('Start with: Open the draft');
    expect(blockText(tomorrow, actionKey)).toContain('Write report');
    expect(blockText(tomorrow, actionKey)).toContain('09:00');
    expect(blockText(tomorrow, habitKey)).toContain('Read');
    expect(blockText(tomorrow, habitKey)).toContain('10:00');
    expect(tomorrow.querySelector('[data-scheduler-drag-key], [data-resize-edge]')).toBeNull();
    const today = container.querySelector('[data-home-calendar="today"]');
    expect(today.querySelector('#tomorrow-scheduler-title').textContent).toBe("Today's calendar · 2026-10-11");
    expect(timelineDate(today)).toContain('2026-10-11');
    expect(today.querySelector(`[data-schedule-key="${actionKey}"]`)).toBeNull();
    const homeBlocks = [actionKey, habitKey].map((key) => blockText(tomorrow, key));

    await act(async () => root.unmount());
    root = createRoot(container);
    vi.setSystemTime(new Date('2026-10-12T09:00:00.000Z'));
    await render(<HomeV2Page />);
    expect(container.querySelector('[data-home-calendar="tomorrow"]')).toBeNull();
    const morning = container.querySelector('[data-home-calendar="today"]');
    expect(morning.querySelector('#tomorrow-scheduler-title').textContent).toBe("Today's calendar · 2026-10-12");
    expect(timelineDate(morning)).toContain('2026-10-12');
    expect(morning.textContent).toContain('Start with: Open the draft');
    expect([actionKey, habitKey].map((key) => blockText(morning, key))).toEqual(homeBlocks);

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<TodayV2Page />);
    const headings = [...container.querySelectorAll('h2')];
    const part1 = headings.find((node) => node.textContent === 'Part 1: Review Today').nextElementSibling;
    expect(part1.textContent).toContain('Write report');
    expect(part1.textContent).toContain('Unanswered');
    const part2Scheduler = container.querySelector('[aria-labelledby="tomorrow-scheduler-title"]');
    expect(part2Scheduler.querySelector('h3').textContent).toBe('Schedule tomorrow');
    expect(timelineDate(part2Scheduler)).toContain('2026-10-13');
    expect(part2Scheduler.querySelector('[data-schedule-key]')).toBeNull();
    expect(container.querySelector('[aria-label^="Tomorrow action"]')).toBeNull();
    expect(persistence.tables.today_v2_commitment_fragments.filter((row) => row.target_local_date === '2026-10-13')).toHaveLength(0);
    expect(persistence.tables.today_v2_schedule_blocks.filter((row) => row.target_local_date === '2026-10-13')).toHaveLength(0);
  });

  it('does not repeat the plan as a separate tomorrow calendar between midnight and 04:00', async () => {
    const plan = await replaceTomorrowActions({
      targetLocalDate: '2026-10-12', sourceLocalDate: '2026-10-11', timezoneName: 'UTC',
      rawPlanText: 'Write report', actionTexts: ['Write report'], firstFiveMinutes: 'Open the draft',
      scheduleAvailable: true, userId: 'flow-user', explicitActions: true,
    });
    await replaceSchedule({
      targetLocalDate: '2026-10-12', timezoneName: 'UTC',
      blocks: [{ source_type: 'action', source_id: plan.savedFragments[0].id, starts_at: '2026-10-12T09:00:00.000Z', ends_at: '2026-10-12T09:30:00.000Z' }],
    });
    await completeTodayV2Review('review-oct-11');
    vi.setSystemTime(new Date('2026-10-12T02:00:00.000Z'));

    await render(<HomeV2Page />);
    expect(container.querySelector('[data-home-calendar="tomorrow"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label^="24-hour timeline"]')).toHaveLength(1);
    const today = container.querySelector('[data-home-calendar="today"]');
    expect(today.querySelector('#tomorrow-scheduler-title').textContent).toBe("Today's calendar · 2026-10-12");
    expect(blockText(today, actionKey)).toContain('09:00');
    expect(container.textContent.match(/Start with:/g)).toHaveLength(1);
    expect(container.textContent).toContain("Today you said you'd prove it by:");
  });
});
