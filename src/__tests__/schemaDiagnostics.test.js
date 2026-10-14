import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase/client', () => ({ supabase: mocks }));
import { diagnoseTodayV2Schema, probeDayScheduleMetadata, TODAY_V2_SCHEMA_PROBES } from '../v2/services/schemaDiagnostics';

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

describe('nonexecuting day-schedule RPC metadata fallback', () => {
    let client;
    let options;
    const response = (status, allow, body = {}) => ({
      ok: status >= 200 && status < 300, status,
      headers: new Headers(allow ? { Allow: allow } : {}),
      json: async () => body,
    });

    it('preserves missing-schema errors through real Supabase GET parsing and never executes an RPC', async () => {
      const fetchRequest = vi.fn(async (address, request) => {
        const url = new URL(address);
        if (request.method === 'OPTIONS') {
          return new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }), { status: 404 });
        }
        if (url.searchParams.get('select')?.includes('planning_mode')) {
          return new Response(JSON.stringify({ code: '42703', message: 'column planning_mode does not exist' }), { status: 400 });
        }
        if (url.pathname.endsWith('/today_v2_day_schedule_writes')) {
          return new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table in the schema cache' }), { status: 404 });
        }
        return new Response('[]', { status: 200 });
      });
      const client = createClient('https://example.invalid', 'test-api-key', {
        global: { fetch: fetchRequest },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'test-session' } }, error: null });
      const result = await diagnoseTodayV2Schema(client, {
        url: 'https://example.invalid', apiKey: 'test-api-key', fetchRequest,
      });
      expect(result.missingMigrations).toEqual([
        '20261010_today_v2_habit_recurrence.sql', '20261011_today_v2_day_schedule.sql',
      ]);
      expect(fetchRequest.mock.calls).toHaveLength(TODAY_V2_SCHEMA_PROBES.length + 1);
      for (const [address, request] of fetchRequest.mock.calls) {
        const url = new URL(address);
        if (url.pathname.includes('/rpc/')) expect(request.method).toBe('OPTIONS');
        else {
          expect(request.method).toBe('GET');
          expect(url.searchParams.get('limit')).toBe('0');
        }
      }
    });
    beforeEach(() => {
      vi.clearAllMocks();
      client = { ...mocks, auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-session' } } }) } };
      options = { url: 'https://example.invalid', apiKey: 'test-api-key', fetchRequest: vi.fn() };
    });

    it('uses authenticated OPTIONS with the exact signature, never mutation POST or executing GET/HEAD', async () => {
      options.fetchRequest.mockResolvedValue(response(200, 'OPTIONS,POST'));
      expect(await probeDayScheduleMetadata(client, options)).toEqual({ status: 'available', code: null });
      const [address, request] = options.fetchRequest.mock.calls[0];
      const url = new URL(address);
      expect(url.pathname).toBe('/rest/v1/rpc/today_v2_update_day_schedule');
      expect([...url.searchParams.keys()].sort()).toEqual([
        'p_ends_at', 'p_source_id', 'p_source_type', 'p_starts_at', 'p_target_local_date', 'p_timezone_name',
      ]);
      expect(request).toMatchObject({
        method: 'OPTIONS',
        headers: { apikey: options.apiKey, Authorization: ['Bearer', 'test-session'].join(' '), 'Accept-Profile': 'public' },
      });
      expect(request.body).toBeUndefined();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('detects an actually missing day RPC even when its private table is hidden', async () => {
      clientWithError((table) => table === 'today_v2_day_schedule_writes' ? { code: 'PGRST205' } : null);
      options.fetchRequest.mockResolvedValue(response(404, null, { code: 'PGRST202' }));
      expect(await diagnoseTodayV2Schema(client, options)).toMatchObject({
        status: 'missing', missingMigrations: ['20261011_today_v2_day_schedule.sql'],
      });
    });

    it('verifies installed day migration through safe metadata despite revoked table SELECT', async () => {
      clientWithError((table) => table === 'today_v2_day_schedule_writes' ? { code: '42501' } : null);
      options.fetchRequest.mockResolvedValue(response(200, 'OPTIONS,POST'));
      expect(await diagnoseTodayV2Schema(client, options)).toMatchObject({
        status: 'available', missingMigrations: [], unresolvedChecks: [],
      });
    });

    it.each([
      response(204, null),
      response(200, 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'),
      response(404, null, {}),
      response(405, null, { code: 'PGRST101' }),
    ])('does not accept gateway preflight or unrelated method errors as existence proof: %j', async (result) => {
      options.fetchRequest.mockResolvedValue(result);
      expect((await probeDayScheduleMetadata(client, options)).status).toBe('unknown');
    });

    it.each([401, 403])('keeps RPC metadata permission failure separate from missing schema: %s', async (status) => {
      options.fetchRequest.mockResolvedValue(response(status, null, { code: 'PGRST202' }));
      expect((await probeDayScheduleMetadata(client, options)).status).toBe('permission');
    });

    it('does not issue metadata requests without an authenticated session', async () => {
      client.auth.getSession.mockResolvedValue({ data: { session: null } });
      expect((await probeDayScheduleMetadata(client, options)).status).toBe('permission');
      expect(options.fetchRequest).not.toHaveBeenCalled();
    });

    it('classifies network failure without declaring migration absent', async () => {
      options.fetchRequest.mockRejectedValue(new TypeError('Failed to fetch'));
      expect((await probeDayScheduleMetadata(client, options)).status).toBe('network');
    });
});

describe('read-only Today V2 schema diagnostics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies required tables and explicit columns without records or mutation RPCs', async () => {
    const queries = clientWithError(() => null);
    expect(await diagnoseTodayV2Schema()).toMatchObject({ status: 'available', missingMigrations: [], unresolvedChecks: [] });
    expect(queries).toHaveLength(TODAY_V2_SCHEMA_PROBES.length);
    expect(queries.every(({ columns, options }) => columns !== '*' && options === undefined)).toBe(true);
    mocks.from.mock.results.forEach(({ value }) => expect(value.limit).toHaveBeenCalledWith(0));
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
