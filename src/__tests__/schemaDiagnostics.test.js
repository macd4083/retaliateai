import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } }));
vi.mock('../lib/supabase/client', () => ({ supabase: mocks }));
import { diagnoseTodayV2Schema, probeDayScheduleMetadata, TODAY_V2_SCHEMA_PROBES } from '../v2/services/schemaDiagnostics';

const args = ['p_target_local_date', 'p_timezone_name', 'p_source_type', 'p_source_id', 'p_starts_at', 'p_ends_at'];
const schema = () => ({ type: 'object', properties: Object.fromEntries(args.map((name) => [name, { type: 'string' }])), required: args });
const swagger = (argumentSchema = schema()) => ({
  swagger: '2.0',
  paths: { '/rpc/today_v2_update_day_schedule': { post: { parameters: [{ in: 'body', schema: argumentSchema }] } } },
});
const response = (document, status = 200) => new Response(JSON.stringify(document), { status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.invalid');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-api-key');
  mocks.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session' } } });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response(swagger())));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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

describe('authenticated OpenAPI day-schedule diagnostics', () => {
  it('GETs only API-root metadata with authentication, never executes an RPC', async () => {
    expect(await probeDayScheduleMetadata()).toEqual({ status: 'available', code: null });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://example.invalid/rest/v1/', {
      method: 'GET',
      headers: {
        apikey: 'test-api-key', Authorization: ['Bearer', 'test-session'].join(' '),
        'Accept-Profile': 'public', Accept: 'application/openapi+json',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps an omitted path unverified because EXECUTE privileges can hide it', async () => {
    clientWithError(() => null);
    fetch.mockImplementation(async () => response({ swagger: '2.0', paths: {} }));
    expect(await diagnoseTodayV2Schema()).toMatchObject({
      status: 'unverified', missingMigrations: [],
      unresolvedChecks: [{ rpc: 'today_v2_update_day_schedule', migration: '20261011_today_v2_day_schedule.sql', status: 'unknown', code: 'OPENAPI_RPC_UNAVAILABLE' }],
    });
  });

  it('maps missing arguments and extra required arguments to the day migration', async () => {
    const incomplete = schema();
    delete incomplete.properties.p_ends_at;
    fetch.mockImplementation(async () => response(swagger(incomplete)));
    expect((await probeDayScheduleMetadata()).status).toBe('missing');
    fetch.mockImplementation(async () => response(swagger({ ...schema(), required: [...args, 'unexpected'] })));
    expect((await probeDayScheduleMetadata()).status).toBe('missing');
  });

  it.each(['swagger', 'openapi'])('resolves local %s schema references only', async (version) => {
    const document = version === 'swagger'
      ? { ...swagger({ $ref: '#/definitions/Arguments' }), definitions: { Arguments: schema() } }
      : { openapi: '3.0.3', paths: { '/rpc/today_v2_update_day_schedule': { post: { requestBody: { content: {
        'application/json': { schema: { $ref: '#/components/schemas/Arguments' } },
      } } } } }, components: { schemas: { Arguments: schema() } } };
    fetch.mockImplementation(async () => response(document));
    expect((await probeDayScheduleMetadata()).status).toBe('available');
  });

  it.each([
    {},
    { swagger: '2.0' },
    swagger({ $ref: 'https://example.invalid/external.json' }),
    { ...swagger({ $ref: '#/definitions/Cycle' }), definitions: { Cycle: { $ref: '#/definitions/Cycle' } } },
  ])('does not mistake unsupported documents or unsafe references for missing schema: %j', async (document) => {
    fetch.mockImplementation(async () => response(document));
    expect((await probeDayScheduleMetadata()).status).toBe('unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('distinguishes permission failure from missing schema: %s', async (status) => {
    fetch.mockImplementation(async () => response({ code: '42501' }, status));
    expect((await probeDayScheduleMetadata()).status).toBe('permission');
  });

  it('does not request documentation without an authenticated session', async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect((await probeDayScheduleMetadata()).status).toBe('permission');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps network failures unverified', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await probeDayScheduleMetadata()).status).toBe('network');
  });

  it('preserves actual Supabase GET error codes and reads only API-root metadata', async () => {
    const fetchRequest = vi.fn(async (address) => {
      const url = new URL(address);
      if (url.pathname === '/rest/v1/') return response({ swagger: '2.0', paths: {} });
      if (url.searchParams.get('select')?.includes('planning_mode')) {
        return response({ code: '42703', message: 'column planning_mode does not exist' }, 400);
      }
      return response([]);
    });
    const client = createClient('https://example.invalid', 'test-api-key', {
      global: { fetch: fetchRequest },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'test-session' } }, error: null });
    const result = await diagnoseTodayV2Schema(client, { fetchRequest });
    expect(result.missingMigrations).toEqual(['20261010_today_v2_habit_recurrence.sql']);
    expect(result.unresolvedChecks[0]).toMatchObject({ migration: '20261011_today_v2_day_schedule.sql', status: 'unknown' });
    expect(fetchRequest.mock.calls).toHaveLength(TODAY_V2_SCHEMA_PROBES.length + 1);
    for (const [address, request] of fetchRequest.mock.calls) {
      const url = new URL(address);
      expect(request.method).toBe('GET');
      expect(request.body).toBeUndefined();
      expect(url.pathname).not.toContain('/rpc/');
      expect(url.pathname).not.toContain('today_v2_day_schedule_writes');
      if (url.pathname !== '/rest/v1/') expect(url.searchParams.get('limit')).toBe('0');
    }
  });
});

describe('read-only Today V2 table/column diagnostics', () => {
  it('verifies available schema without loading records or probing the private table', async () => {
    const queries = clientWithError(() => null);
    expect(await diagnoseTodayV2Schema()).toMatchObject({ status: 'available', missingMigrations: [], unresolvedChecks: [] });
    expect(queries).toHaveLength(TODAY_V2_SCHEMA_PROBES.length);
    expect(queries.every(({ table, columns, options }) => table !== 'today_v2_day_schedule_writes' && columns !== '*' && options === undefined)).toBe(true);
    mocks.from.mock.results.forEach(({ value }) => expect(value.limit).toHaveBeenCalledWith(0));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('detects recurrence columns independently of the old habit-query fallback', async () => {
    clientWithError((table, columns) => table === 'today_v2_habit_definitions' && columns.includes('planning_mode')
      ? { code: '42703', message: 'column planning_mode does not exist' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual(['20261010_today_v2_habit_recurrence.sql']);
  });

  it('maps recurrence overrides and automatic-block columns to the recurrence migration', async () => {
    clientWithError((table, columns) => table === 'today_v2_habit_schedule_overrides'
      ? { code: 'PGRST205' } : columns === 'is_automatic' ? { code: 'PGRST204' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual(['20261010_today_v2_habit_recurrence.sql']);
  });

  it.each([
    [{ code: '42501', message: 'permission denied' }, 'permission'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'permission'],
    [{ message: 'Failed to fetch' }, 'network'],
    [{ code: 'PGRST002', message: 'schema cache initialization failed' }, 'network'],
    [{ code: 'XX000', message: 'unexpected error' }, 'unknown'],
  ])('keeps non-schema errors separate from missing migrations: %j', async (error, status) => {
    clientWithError(() => error);
    const result = await diagnoseTodayV2Schema();
    expect(result).toMatchObject({ status: 'unverified', missingMigrations: [] });
    expect(result.unresolvedChecks.every((check) => check.status === status)).toBe(true);
  });

  it('maps missing base tables to their owner migration, not all subsequent migrations', async () => {
    clientWithError((table) => table === 'today_v2_habit_definitions' ? { code: '42P01' } : null);
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual(['20260928_today_v2_workflow.sql']);
  });

  it('orders exact migration filenames by production dependencies', async () => {
    clientWithError((table, columns) => table === 'today_v2_schedule_blocks'
      ? { code: '42P01' } : columns === 'controllable_focus' ? { code: '42703' } : null);
    const incomplete = schema();
    delete incomplete.properties.p_ends_at;
    fetch.mockImplementation(async () => response(swagger(incomplete)));
    expect((await diagnoseTodayV2Schema()).missingMigrations).toEqual([
      '20261006_today_v2_controllable_and_first_five.sql',
      '20261007_today_v2_scheduling.sql',
      '20261011_today_v2_day_schedule.sql',
    ]);
  });
});
