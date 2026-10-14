import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase/client', () => ({ supabase: mocks }));
import { diagnoseTodayV2Schema, TODAY_V2_SCHEMA_PROBES } from '../v2/services/schemaDiagnostics';

function clientWithError(failure) {
  const queries = [];
  mocks.from.mockImplementation((table) => {
    const query = {
      select: vi.fn((columns, options) => {
        queries.push({ table, columns, options });
        query.result = { error: failure(table, columns) };
        return query;
      }),
      limit: vi.fn(() => Promise.resolve(query.result)),
    };
    return query;
  });
  return queries;
}

describe('read-only Today V2 schema diagnostics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies required tables and explicit columns without records or mutation RPCs', async () => {
    const queries = clientWithError(() => null);
    expect(await diagnoseTodayV2Schema()).toMatchObject({ status: 'available', missingMigrations: [], unresolvedChecks: [] });
    expect(queries).toHaveLength(TODAY_V2_SCHEMA_PROBES.length);
    expect(queries.every(({ columns, options }) => columns !== '*' && options.head === true)).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('detects recurrence columns even when old habit-definition queries can succeed', async () => {
    clientWithError((table, columns) => table === 'today_v2_habit_definitions' && columns.includes('planning_mode')
      ? { code: '42703', message: 'column planning_mode does not exist' } : null);
    expect(await diagnoseTodayV2Schema()).toMatchObject({
      status: 'missing', missingMigrations: ['20261010_today_v2_habit_recurrence.sql'],
    });
  });

  it('maps recurrence override and automatic-block columns to the recurrence migration', async () => {
    clientWithError((table, columns) => table === 'today_v2_habit_schedule_overrides'
      ? { code: 'PGRST205' } : columns === 'is_automatic' ? { code: 'PGRST204' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual(['20261010_today_v2_habit_recurrence.sql']);
  });

  it('identifies a definitively missing day-schedule relation without invoking its RPC', async () => {
    clientWithError((table) => table === 'today_v2_day_schedule_writes' ? { code: '42P01' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual(['20261011_today_v2_day_schedule.sql']);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
    { code: '42501', message: 'permission denied for table today_v2_day_schedule_writes' },
  ])('never calls inaccessible day schema missing: $code', async (error) => {
    clientWithError((table) => table === 'today_v2_day_schedule_writes' ? error : null);
    const result = await diagnoseTodayV2Schema();
    expect(result.status).toBe('unverified');
    expect(result.missingMigrations).toEqual([]);
    expect(result.unresolvedChecks[0].migration).toBe('20261011_today_v2_day_schedule.sql');
  });

  it.each([
    [{ code: '42501', message: 'permission denied' }, 'permission'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'permission'],
    [{ message: 'Failed to fetch' }, 'network'],
    [{ code: 'PGRST002', message: 'schema cache initialization failed' }, 'network'],
    [{ code: 'XX000', message: 'unexpected error' }, 'unknown'],
    [{ message: 'something does not exist' }, 'unknown'],
  ])('keeps non-schema failures separate from missing migrations: %j', async (error, status) => {
    clientWithError(() => error);
    const result = await diagnoseTodayV2Schema();
    expect(result).toMatchObject({ status: 'unverified', missingMigrations: [] });
    expect(result.unresolvedChecks.every((check) => check.status === status)).toBe(true);
  });

  it('handles rejected network requests', async () => {
    mocks.from.mockImplementation(() => ({ select: () => ({ limit: () => Promise.reject(new TypeError('Failed to fetch')) }) }));
    expect((await diagnoseTodayV2Schema()).checks.every((check) => check.status === 'network')).toBe(true);
  });

  it('maps missing base tables to their owner migration rather than all later column migrations', async () => {
    clientWithError((table) => table === 'today_v2_habit_definitions' ? { code: '42P01' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual(['20260928_today_v2_workflow.sql']);
  });

  it('returns exact migration filenames in dependency order', async () => {
    clientWithError((table, columns) => table === 'today_v2_schedule_blocks'
      ? { code: '42P01' } : columns === 'controllable_focus' ? { code: '42703' }
        : table === 'today_v2_day_schedule_writes' ? { code: '42P01' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual([
      '20261006_today_v2_controllable_and_first_five.sql',
      '20261007_today_v2_scheduling.sql',
      '20261011_today_v2_day_schedule.sql',
    ]);
  });
});
