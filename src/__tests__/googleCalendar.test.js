// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createGoogleCalendarHandler, decrypt, encrypt, encryptionKey, eventRange, GOOGLE_CALENDAR_SCOPES, normalizeEvent } from '../../server/googleCalendar.js';
import apiHandler from '../../api/google-calendar.js';

const USER = 'user-calendar-test';
const OTHER = 'another-user';
const CLOCK = Date.parse('2026-10-06T12:00:00Z');
const KEY = Buffer.alloc(32, 7);
const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: 'calendar-client',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'calendar-client-test-value',
  GOOGLE_CALENDAR_REDIRECT_URI: 'https://example.test/api/google-calendar?action=callback',
  GOOGLE_CALENDAR_ENCRYPTION_KEY: KEY.toString('base64'),
  APP_ORIGIN: 'https://example.test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-value',
};
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const googleResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function mockDatabase() {
  const connections = new Map();
  const states = new Map();
  const operations = [];
  const db = {
    connections, states, operations,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER } }, error: null })) },
    rpc: vi.fn(async (name, { p_state_hash: stateHash, p_tokens_encrypted: encrypted, p_selected_calendar_ids: selected }) => {
      const row = states.get(stateHash);
      if (!row || Date.parse(row.expires_at) <= CLOCK) return { data: [], error: null };
      states.delete(stateHash);
      if (name === 'today_v2_finish_google_authorization') {
        const connection = { user_id: row.user_id, tokens_encrypted: encrypted, selected_calendar_ids: selected,
          updated_at: new Date(CLOCK).toISOString() };
        connections.set(row.user_id, connection);
        return { data: [connection], error: null };
      }
      return { data: [row], error: null };
    }),
    from: vi.fn((table) => {
      const rows = table === 'today_v2_google_connections' ? connections : states;
      const record = { table, filters: [], action: 'select', payload: null };
      operations.push(record);
      const builder = {
        select: () => builder,
        eq: (field, value) => { record.filters.push([field, value]); return builder; },
        limit: () => builder,
        maybeSingle: () => { record.single = true; return builder; },
        insert: (payload) => { record.action = 'insert'; record.payload = payload; return builder; },
        upsert: (payload) => { record.action = 'upsert'; record.payload = payload; return builder; },
        update: (payload) => { record.action = 'update'; record.payload = payload; return builder; },
        delete: () => { record.action = 'delete'; return builder; },
        then: (resolve, reject) => {
          const matching = [...rows.entries()].filter(([, row]) => record.filters.every(([field, value]) => row[field] === value));
          let data = record.single ? matching[0]?.[1] || null : matching.map(([, row]) => row);
          if (['insert', 'upsert'].includes(record.action)) {
            const key = record.payload.user_id && table === 'today_v2_google_connections' ? record.payload.user_id : record.payload.state_hash;
            rows.set(key, { ...(rows.get(key) || {}), ...record.payload });
            data = null;
          }
          if (record.action === 'delete') { matching.forEach(([key]) => rows.delete(key)); data = null; }
          if (record.action === 'update') {
            matching.forEach(([key, row]) => rows.set(key, { ...row, ...record.payload }));
            data = record.single ? (matching.length ? rows.get(matching[0][0]) : null) : null;
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    }),
  };
  return db;
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    redirect(code, url) { this.statusCode = code; this.location = url; return this; },
  };
}

describe('secure Google Calendar backend', () => {
  let db;
  let fetchImpl;
  let handler;
  let sleep;
  beforeEach(() => {
    db = mockDatabase();
    fetchImpl = vi.fn();
    sleep = vi.fn(async () => {});
    handler = createGoogleCalendarHandler({ env: ENV, supabase: db, fetchImpl, now: () => CLOCK, sleep });
  });
  async function call(action, { body = {}, query = {}, headers = {}, method } = {}) {
    const res = response();
    await handler({
      method: method || (['connect', 'select', 'disconnect', 'create', 'update', 'delete'].includes(action) ? 'POST' : 'GET'),
      query: { action, ...query }, body,
      headers: { authorization: ['Bearer', 'supabase-test-value'].join(' '), ...headers },
    }, res);
    return res;
  }
  function connected({ selected = ['primary'], expired = false, userId = USER, scopes } = {}) {
    const tokens = { access_token: 'google-access-test-value', refresh_token: 'google-refresh-test-value',
      expires_at: CLOCK + (expired ? -1 : 3600000), ...(scopes ? { scopes } : {}) };
    db.connections.set(userId, { user_id: userId, tokens_encrypted: encrypt(tokens, KEY, `tokens:${userId}`), selected_calendar_ids: selected });
    return tokens;
  }
  async function flow(returnPath = '/today') {
    const res = await call('connect', { body: { returnPath, user_id: OTHER } });
    const authorization = new URL(res.body.authorizationUrl);
    return { res, state: authorization.searchParams.get('state'), cookie: res.headers['Set-Cookie'].split(';')[0], authorization };
  }
  function tokenSuccess(extra = {}) {
    fetchImpl.mockResolvedValueOnce(googleResponse({ access_token: 'new-google-access-value', refresh_token: 'new-google-refresh-value', expires_in: 3600, scope: GOOGLE_CALENDAR_SCOPES.join(' '), ...extra }));
  }
  const range = { timeMin: '2026-10-06T00:00:00Z', timeMax: '2026-10-08T00:00:00Z' };
  const event = { id: 'event-1', start: { dateTime: '2026-10-06T10:00:00Z' }, end: { dateTime: '2026-10-06T11:00:00Z' } };

  it('exports a single deployable handler', () => expect(typeof apiHandler).toBe('function'));
  it('encrypts nondeterministically with authenticated user/context binding', () => {
    const one = encrypt({ refresh_token: 'credential-test-value' }, KEY, `tokens:${USER}`);
    expect(one).not.toContain('credential');
    expect(encrypt({ refresh_token: 'credential-test-value' }, KEY, `tokens:${USER}`)).not.toBe(one);
    expect(decrypt(one, KEY, `tokens:${USER}`)).toEqual({ refresh_token: 'credential-test-value' });
    expect(() => decrypt(one, KEY, `tokens:${OTHER}`)).toThrow();
    expect(() => decrypt(one.slice(0, -3) + 'abc', KEY, `tokens:${USER}`)).toThrow();
    expect(() => decrypt(one, Buffer.alloc(32, 8), `tokens:${USER}`)).toThrow();
    expect(() => encryptionKey('not-a-key')).toThrow();
  });
  it.each(['status', 'connect', 'calendars', 'select', 'events', 'disconnect', 'create', 'update', 'delete'])('requires verified Supabase bearer auth for %s', async (action) => {
    const res = await call(action, { headers: { authorization: '' } });
    expect(res.statusCode).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
  it('does not trust user IDs in submitted input', async () => {
    db.auth.getUser.mockResolvedValueOnce({ data: { user: { id: USER } } });
    const { authorization } = await flow();
    expect(db.auth.getUser).toHaveBeenCalledWith('supabase-test-value');
    expect(db.states.get(hash(authorization.searchParams.get('state'))).user_id).toBe(USER);
  });
  it('returns a useful safe missing-configuration status', async () => {
    handler = createGoogleCalendarHandler({ env: { ...ENV, GOOGLE_CALENDAR_CLIENT_SECRET: '' }, supabase: db });
    const res = await call('status');
    expect(res.body).toMatchObject({ configured: false, connected: false, schemaAvailable: true });
    expect(res.body.message).toContain('GOOGLE_CALENDAR_CLIENT_SECRET');
    expect(JSON.stringify(res.body)).not.toContain(ENV.SUPABASE_SERVICE_ROLE_KEY);
  });
  it('reports an existing connection without decryption when Google configuration is removed', async () => {
    connected();
    db.connections.get(USER).tokens_encrypted = 'unreadable-after-lost-key';
    handler = createGoogleCalendarHandler({ env: { ...ENV, GOOGLE_CALENDAR_CLIENT_SECRET: '', GOOGLE_CALENDAR_ENCRYPTION_KEY: '' }, supabase: db, fetchImpl });
    const res = await call('status');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ configured: false, schemaAvailable: true, connected: true, selectedCalendarIds: ['primary'] });
    expect(res.body.message).toContain('GOOGLE_CALENDAR_ENCRYPTION_KEY');
    expect(JSON.stringify(res.body)).not.toContain('unreadable-after-lost-key');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await call('disconnect')).statusCode).toBe(200);
    expect(db.connections.has(USER)).toBe(false);
  });
  it('still reports an existing connection when missing Google configuration coincides with unavailable state schema', async () => {
    connected();
    handler = createGoogleCalendarHandler({ env: { ...ENV, GOOGLE_CALENDAR_CLIENT_SECRET: '' }, supabase: db });
    db.rpc.mockResolvedValueOnce({ error: { message: 'RPC missing' } });
    const res = await call('status');
    expect(res.body).toMatchObject({ configured: false, schemaAvailable: false, connected: true, selectedCalendarIds: ['primary'] });
  });
  it('detects unavailable schema and the required atomic RPC', async () => {
    db.rpc.mockResolvedValueOnce({ error: { message: 'RPC missing' } });
    const res = await call('status');
    expect(res.body).toMatchObject({ configured: true, schemaAvailable: false, connected: false });
  });
  it('detects an unavailable atomic authorization finalizer in status', async () => {
    db.rpc.mockImplementation(async (name) => name === 'today_v2_finish_google_authorization' ?
      { data: null, error: { message: 'Finalizer missing' } } : { data: [], error: null });
    expect((await call('status')).body.schemaAvailable).toBe(false);
  });
  it('reports legacy permission status without returning credentials', async () => {
    connected();
    const res = await call('status');
    expect(res.body).toEqual({ configured: true, schemaAvailable: true, connected: true, selectedCalendarIds: ['primary'],
      canWrite: false, needsUpgrade: true });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects incorrect methods, actions and cross-origin mutations', async () => {
    expect((await call('connect', { method: 'GET' })).statusCode).toBe(405);
    expect((await call('unknown')).statusCode).toBe(400);
    expect((await call('connect', { headers: { origin: 'https://attacker.test' } })).statusCode).toBe(403);
  });
  it('uses exact least-privilege scopes, offline access, PKCE and hashed bound expiring state', async () => {
    const { res, authorization, state } = await flow();
    expect(authorization.searchParams.get('scope').split(' ')).toEqual(GOOGLE_CALENDAR_SCOPES);
    expect(authorization.searchParams.get('access_type')).toBe('offline');
    expect(authorization.searchParams.get('redirect_uri')).toBe(ENV.GOOGLE_CALENDAR_REDIRECT_URI);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const pending = db.states.get(hash(state));
    expect(pending.return_path).toBe('/today');
    expect(Date.parse(pending.expires_at) - CLOCK).toBe(600000);
    const binding = decrypt(pending.verifier_encrypted, KEY, `state:${hash(state)}`);
    expect(authorization.searchParams.get('code_challenge')).toBe(hash(binding.verifier));
    expect(res.headers['Set-Cookie']).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(JSON.stringify(pending)).not.toContain(state);
    expect(res.body).not.toHaveProperty('verifier');
  });
  it.each(['https://attacker.test', '//attacker.test', '/today?next=evil', '/settings#evil', '/Today', '', null])('rejects a submitted unsafe return destination: %s', async (returnPath) => {
    const res = await call('connect', { body: { returnPath } });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid_return_path');
    expect(db.states.size).toBe(0);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });
  it('defaults only a missing return destination to /today', async () => {
    const res = await call('connect');
    expect(res.statusCode).toBe(200);
    expect([...db.states.values()][0].return_path).toBe('/today');
  });
  it.each(['localhost', '127.0.0.1'])('supports HTTP loopback development on %s with a signed non-Secure cookie', async (hostname) => {
    const origin = `http://${hostname}:3000`;
    handler = createGoogleCalendarHandler({ env: { ...ENV, APP_ORIGIN: origin, GOOGLE_CALENDAR_REDIRECT_URI: `${origin}/api/google-calendar?action=callback` },
      supabase: db, fetchImpl, now: () => CLOCK });
    const { res, state, cookie, authorization } = await flow();
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${origin}/api/google-calendar?action=callback`);
    expect(res.headers['Set-Cookie']).toMatch(/^google-calendar-nonce=/);
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Lax');
    expect(res.headers['Set-Cookie']).not.toContain('Secure');
    tokenSuccess();
    const callback = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(callback.location).toBe(`${origin}/today?googleCalendar=connected`);
  });
  it.each(['example.test', 'localhost.attacker.test', '127.0.0.2'])('rejects insecure non-loopback origins: %s', async (hostname) => {
    const origin = `http://${hostname}:3000`;
    handler = createGoogleCalendarHandler({ env: { ...ENV, APP_ORIGIN: origin, GOOGLE_CALENDAR_REDIRECT_URI: `${origin}/api/google-calendar?action=callback` }, supabase: db });
    expect((await call('status')).body.configured).toBe(false);
    expect((await call('connect')).body.code).toBe('not_configured');
  });
  it('rejects callback in a wrong browser before consuming state or exchanging code', async () => {
    const { state } = await flow();
    const res = await call('callback', { headers: { authorization: '', cookie: '' }, query: { state, code: 'test-code' } });
    expect(res.body.code).toBe('invalid_state');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.states.has(hash(state))).toBe(true);
  });
  it('rejects a valid signed cookie belonging to a different flow', async () => {
    const first = await flow();
    const firstState = [...db.states.values()][0];
    const second = await flow();
    db.states.set(hash(first.state), firstState);
    const res = await call('callback', { query: { state: first.state, code: 'code' }, headers: { cookie: second.cookie } });
    expect(res.body.code).toBe('invalid_state');
    expect(db.states.has(hash(first.state))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects a tampered nonce signature without consuming state', async () => {
    const { state, cookie } = await flow();
    const separator = cookie.lastIndexOf('.');
    const altered = `${cookie.slice(0, separator + 1)}${cookie[separator + 1] === 'A' ? 'B' : 'A'}${cookie.slice(separator + 2)}`;
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie: altered } });
    expect(res.body.code).toBe('invalid_state');
    expect(db.states.has(hash(state))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([null, '', 'short', 42])('rejects a malformed encrypted PKCE verifier: %s', async (verifier) => {
    const { state, cookie } = await flow();
    const pending = db.states.get(hash(state));
    const binding = decrypt(pending.verifier_encrypted, KEY, `state:${hash(state)}`);
    pending.verifier_encrypted = encrypt({ ...binding, verifier }, KEY, `state:${hash(state)}`);
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.body.code).toBe('invalid_state');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.states.has(hash(state))).toBe(true);
  });
  it('never redirects to an unsafe persisted return path', async () => {
    const { state, cookie } = await flow();
    db.states.get(hash(state)).return_path = 'https://attacker.test';
    tokenSuccess();
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.location).toBe('https://example.test/today?googleCalendar=connected');
  });
  it('consumes state atomically, exchanges PKCE, persists encrypted credentials and prevents replay', async () => {
    const { state, cookie } = await flow('/settings');
    tokenSuccess();
    const res = await call('callback', { query: { state, code: 'test-code' }, headers: { authorization: '', cookie } });
    expect(res.statusCode).toBe(303);
    expect(res.location).toBe('https://example.test/settings?googleCalendar=connected');
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(db.connections.has(USER)).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith('today_v2_finish_google_authorization', {
      p_state_hash: hash(state), p_tokens_encrypted: db.connections.get(USER).tokens_encrypted, p_selected_calendar_ids: [],
    });
    expect(db.rpc.mock.calls.some(([name]) => name === 'today_v2_consume_google_state')).toBe(false);
    expect(db.operations.some((operation) => operation.action === 'upsert')).toBe(false);
    expect(JSON.stringify(db.connections.get(USER))).not.toContain('new-google-access-value');
    const exchange = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(exchange.get('code_verifier')).toHaveLength(43);
    expect(exchange.get('redirect_uri')).toBe(ENV.GOOGLE_CALENDAR_REDIRECT_URI);
    expect((await call('callback', { query: { state, code: 'test-code' }, headers: { cookie } })).body.code).toBe('invalid_state');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rejects expired state without exchanging credentials', async () => {
    const { state, cookie } = await flow();
    db.states.get(hash(state)).expires_at = new Date(CLOCK - 1).toISOString();
    expect((await call('callback', { query: { state, code: 'code' }, headers: { cookie } })).body.code).toBe('invalid_state');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('consumes denied consent and redirects to only the fixed return path', async () => {
    const { state, cookie } = await flow('/settings');
    const res = await call('callback', { query: { state, error: 'access_denied' }, headers: { cookie } });
    expect(res.location).toBe('https://example.test/settings?googleCalendar=denied');
    expect(db.states.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['/today', '/settings'])('returns provider failures safely to %s and consumes state without leaking errors', async (path) => {
    const { state, cookie } = await flow(path);
    fetchImpl.mockResolvedValueOnce(googleResponse({ error: 'invalid_grant', error_description: 'secret-provider-message' }, 400));
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.statusCode).toBe(303);
    expect(res.location).toBe(`https://example.test${path}?googleCalendar=error`);
    expect(JSON.stringify(res)).not.toContain('secret-provider-message');
    expect(db.states.size).toBe(0);
    expect(db.connections.size).toBe(0);
    expect((await call('callback', { query: { state, code: 'code' }, headers: { cookie } })).body.code).toBe('invalid_state');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('does not consume another browser state on a provider error callback', async () => {
    const { state } = await flow();
    const res = await call('callback', { query: { state, error: 'access_denied' }, headers: { cookie: '' } });
    expect(res.body.code).toBe('invalid_state');
    expect(db.states.has(hash(state))).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects cross-origin disconnect without deleting tokens or locked OAuth state', async () => {
    connected();
    await flow();
    const res = await call('disconnect', { headers: { origin: 'https://attacker.test' } });
    expect(res.body.code).toBe('invalid_origin');
    expect(db.connections.has(USER)).toBe(true);
    expect(db.states.size).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('atomically consumes malformed callbacks without attempting token exchange or finalization', async () => {
    const { state, cookie } = await flow();
    const res = await call('callback', { query: { state }, headers: { cookie } });
    expect(res.location).toBe('https://example.test/today?googleCalendar=error');
    expect(db.states.size).toBe(0);
    expect(db.rpc).toHaveBeenCalledWith('today_v2_consume_google_state', { p_state_hash: hash(state) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('cannot recreate credentials when disconnect succeeds during a paused token exchange', async () => {
    connected();
    const { state, cookie } = await flow();
    let releaseExchange;
    let exchangeStarted;
    const started = new Promise((resolve) => { exchangeStarted = resolve; });
    const exchange = new Promise((resolve) => { releaseExchange = resolve; });
    fetchImpl.mockImplementation((url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        exchangeStarted();
        return exchange;
      }
      return Promise.resolve(googleResponse({}));
    });
    const callback = call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    await started;
    // The validated state remains pending until the token exchange can be atomically finalized.
    expect(db.states.has(hash(state))).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
    expect((await call('disconnect')).statusCode).toBe(200);
    expect(db.connections.has(USER)).toBe(false);
    expect(db.states.size).toBe(0);
    const deletes = db.operations.filter((operation) => operation.action === 'delete');
    expect(deletes.slice(-2).map((operation) => operation.table)).toEqual([
      'today_v2_google_oauth_states', 'today_v2_google_connections',
    ]);
    releaseExchange(googleResponse({ access_token: 'late-access-value', refresh_token: 'late-refresh-value', expires_in: 3600 }));
    const res = await callback;
    expect(res.statusCode).toBe(303);
    expect(res.location).toBe('https://example.test/today?googleCalendar=error');
    expect(db.connections.has(USER)).toBe(false);
    const revocations = fetchImpl.mock.calls.filter(([url]) => url === 'https://oauth2.googleapis.com/revoke');
    expect(revocations).toHaveLength(2);
    expect(new URLSearchParams(revocations[1][1].body).get('token')).toBe('late-refresh-value');
  });
  it('revokes a newly issued grant if state expires during the token exchange', async () => {
    const { state, cookie } = await flow();
    fetchImpl.mockImplementationOnce(async () => {
      db.states.get(hash(state)).expires_at = new Date(CLOCK - 1).toISOString();
      return googleResponse({ access_token: 'expired-state-access-value', refresh_token: 'expired-state-refresh-value', expires_in: 3600 });
    });
    fetchImpl.mockResolvedValueOnce(googleResponse({}));
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.location).toBe('https://example.test/today?googleCalendar=error');
    expect(db.connections.size).toBe(0);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/revoke');
    expect(new URLSearchParams(fetchImpl.mock.calls[1][1].body).get('token')).toBe('expired-state-refresh-value');
  });
  it('does not persist credentials if atomic finalization fails and revocation is unavailable', async () => {
    const { state, cookie } = await flow();
    tokenSuccess();
    db.rpc.mockResolvedValueOnce({ error: { message: 'Atomic finalization unavailable' } });
    fetchImpl.mockRejectedValueOnce(new Error('Revoke unavailable'));
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.location).toBe('https://example.test/today?googleCalendar=error');
    expect(db.connections.size).toBe(0);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/revoke');
  });
  it('preserves existing refresh token and selection on reconnect', async () => {
    const old = connected();
    const { state, cookie } = await flow();
    tokenSuccess({ refresh_token: undefined });
    expect((await call('callback', { query: { state, code: 'code' }, headers: { cookie } })).statusCode).toBe(303);
    const saved = db.connections.get(USER);
    expect(decrypt(saved.tokens_encrypted, KEY, `tokens:${USER}`).refresh_token).toBe(old.refresh_token);
    expect(saved.selected_calendar_ids).toEqual(['primary']);
  });
  it('repairs an unreadable connection after key rotation with fresh offline consent', async () => {
    connected();
    const rotatedKey = Buffer.alloc(32, 9);
    handler = createGoogleCalendarHandler({ env: { ...ENV, GOOGLE_CALENDAR_ENCRYPTION_KEY: rotatedKey.toString('base64') },
      supabase: db, fetchImpl, now: () => CLOCK });
    const { state, cookie } = await flow();
    tokenSuccess();
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.statusCode).toBe(303);
    const saved = db.connections.get(USER);
    expect(decrypt(saved.tokens_encrypted, rotatedKey, `tokens:${USER}`).refresh_token).toBe('new-google-refresh-value');
    expect(saved.selected_calendar_ids).toEqual(['primary']);
    expect(() => decrypt(saved.tokens_encrypted, KEY, `tokens:${USER}`)).toThrow();
  });
  it('requires a fresh refresh token when reconnecting an unreadable connection', async () => {
    connected();
    db.connections.get(USER).tokens_encrypted = 'unreadable';
    const { state, cookie } = await flow();
    tokenSuccess({ refresh_token: undefined });
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.location).toBe('https://example.test/today?googleCalendar=error');
    expect(db.connections.get(USER).tokens_encrypted).toBe('unreadable');
  });
  it('repairs unreadable credentials without preserving an unsafe stored selection', async () => {
    connected({ selected: Array(11).fill('primary') });
    db.connections.get(USER).tokens_encrypted = 'unreadable';
    const { state, cookie } = await flow();
    tokenSuccess();
    const res = await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
    expect(res.statusCode).toBe(303);
    expect(db.connections.get(USER).selected_calendar_ids).toEqual([]);
    expect(decrypt(db.connections.get(USER).tokens_encrypted, KEY, `tokens:${USER}`).refresh_token).toBe('new-google-refresh-value');
  });
  it('rejects incomplete consent and missing refresh token for a first connection', async () => {
    const { state, cookie } = await flow();
    tokenSuccess({ scope: GOOGLE_CALENDAR_SCOPES[0] });
    expect((await call('callback', { query: { state, code: 'code' }, headers: { cookie } })).location).toBe('https://example.test/today?googleCalendar=error');
    expect(db.connections.size).toBe(0);
    const next = await flow();
    tokenSuccess({ refresh_token: undefined });
    expect((await call('callback', { query: { state: next.state, code: 'code' }, headers: { cookie: next.cookie } })).location).toBe('https://example.test/today?googleCalendar=error');
  });
  it('refreshes expired access tokens server-side while preserving refresh tokens', async () => {
    const old = connected({ expired: true });
    tokenSuccess({ refresh_token: undefined });
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [event] }));
    const res = await call('events', { query: range });
    expect(res.statusCode).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(decrypt(db.connections.get(USER).tokens_encrypted, KEY, `tokens:${USER}`).refresh_token).toBe(old.refresh_token);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe(['Bearer', 'new-google-access-value'].join(' '));
    expect(JSON.stringify(res.body)).not.toContain('access');
  });
  it.each(['calendars', 'events'])('offers repair for unreadable credentials on %s without losing saved selections', async (action) => {
    connected({ selected: ['primary', 'work'] });
    db.connections.get(USER).tokens_encrypted = 'unreadable';
    const res = await call(action, { query: range });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('reconnect_required');
    expect(db.connections.get(USER).selected_calendar_ids).toEqual(['primary', 'work']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('requires reconnection when refresh no longer grants both read-only permissions', async () => {
    connected({ expired: true });
    tokenSuccess({ scope: GOOGLE_CALENDAR_SCOPES[0] });
    const res = await call('calendars');
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('reconnect_required');
    expect(db.connections.has(USER)).toBe(false);
  });
  it('handles revoked refresh tokens and removes only the authenticated connection', async () => {
    connected({ expired: true });
    connected({ userId: OTHER });
    fetchImpl.mockResolvedValueOnce(googleResponse({ error: 'invalid_grant' }, 400));
    const res = await call('events', { query: range });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('reconnect_required');
    expect(db.connections.has(USER)).toBe(false);
    expect(db.connections.has(OTHER)).toBe(true);
  });
  it('refreshes once after an upstream access-token rejection', async () => {
    connected();
    fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
    tokenSuccess({ refresh_token: undefined });
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [event] }));
    expect((await call('events', { query: range })).statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(db.connections.has(USER)).toBe(true);
  });
  it('requires reconnection if Google rejects even a newly refreshed token', async () => {
    connected();
    fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
    tokenSuccess({ refresh_token: undefined });
    fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
    const res = await call('events', { query: range });
    expect(res.body.code).toBe('reconnect_required');
    expect(db.connections.has(USER)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('deletes credentials and pending state even when Google revocation fails', async () => {
    connected();
    await flow();
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const res = await call('disconnect');
    expect(res.statusCode).toBe(200);
    expect(db.connections.size).toBe(0);
    expect(db.states.size).toBe(0);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke');
  });
  it('disconnects even if credentials cannot be decrypted', async () => {
    connected();
    db.connections.get(USER).tokens_encrypted = 'broken';
    expect((await call('disconnect')).statusCode).toBe(200);
    expect(db.connections.size).toBe(0);
  });
  it.each([
    { GOOGLE_CALENDAR_ENCRYPTION_KEY: '' },
    { GOOGLE_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') },
    { GOOGLE_CALENDAR_CLIENT_SECRET: '', GOOGLE_CALENDAR_CLIENT_ID: '', GOOGLE_CALENDAR_REDIRECT_URI: '', APP_ORIGIN: '' },
  ])('disconnects despite missing or rotated Google configuration: %j', async (missing) => {
    connected();
    connected({ userId: OTHER });
    await flow();
    handler = createGoogleCalendarHandler({ env: { ...ENV, ...missing }, supabase: db, fetchImpl, now: () => CLOCK });
    fetchImpl.mockRejectedValue(new Error('revocation unavailable'));
    const res = await call('disconnect');
    expect(res.statusCode).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(db.connections.has(USER)).toBe(false);
    expect(db.connections.has(OTHER)).toBe(true);
    expect(db.states.size).toBe(0);
  });
  it('enforces a bounded explicit timezone date range', () => {
    expect(eventRange(range.timeMin, range.timeMax)).toEqual({ ...range, timeMin: '2026-10-06T00:00:00.000Z', timeMax: '2026-10-08T00:00:00.000Z' });
    expect(eventRange(range.timeMin, '2026-10-08T01:00:00Z').timeMax).toBe('2026-10-08T01:00:00.000Z');
    expect(() => eventRange(range.timeMin, '2026-10-08T01:00:01Z')).toThrow();
    expect(() => eventRange(range.timeMin, range.timeMin)).toThrow();
    expect(() => eventRange('2026-10-06', '2026-10-07')).toThrow();
  });
  it('supports a bounded 49-hour DST day plus next-day spillover range', async () => {
    connected();
    const spillover = { ...event, start: { dateTime: '2026-11-02T05:15:00Z' }, end: { dateTime: '2026-11-02T05:45:00Z' } };
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [spillover] }));
    const query = { timeMin: '2026-11-01T04:00:00Z', timeMax: '2026-11-03T05:00:00Z' };
    const res = await call('events', { query });
    expect(res.statusCode).toBe(200);
    expect(res.body.events[0].start).toBe('2026-11-02T05:15:00Z');
    const requested = new URL(fetchImpl.mock.calls[0][0]);
    expect(requested.searchParams.get('timeMax')).toBe('2026-11-03T05:00:00.000Z');
    fetchImpl.mockClear();
    expect((await call('events', { query: { ...query, timeMax: '2026-11-03T05:00:01Z' } })).body.code).toBe('invalid_range');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('validates calendar selections against the Google list and caps them at 10', async () => {
    connected();
    expect((await call('select', { body: { calendarIds: Array(11).fill('primary') } })).statusCode).toBe(400);
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ id: 'primary', summary: 'Work', primary: true }] }));
    expect((await call('select', { body: { calendarIds: ['attacker-calendar'] } })).body.code).toBe('invalid_selection');
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ id: 'primary', summary: 'Work' }] }));
    expect((await call('select', { body: { calendarIds: ['primary'], user_id: OTHER } })).body.selectedCalendarIds).toEqual(['primary']);
    expect((await call('select', { body: { calendarIds: [] } })).body.selectedCalendarIds).toEqual([]);
  });
  it('does not report a selection saved after a concurrent disconnect', async () => {
    connected();
    fetchImpl.mockImplementationOnce(async () => {
      db.connections.delete(USER);
      return googleResponse({ items: [{ id: 'primary' }] });
    });
    const res = await call('select', { body: { calendarIds: ['primary'] } });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('not_connected');
    expect(db.connections.has(USER)).toBe(false);
  });
  it.each([{ selected: [] }, { selected: ['primary', 'secondary'] }])('persists explicit empty or multiple selection on reconnect: %j', async ({ selected }) => {
    connected({ selected });
    const { state, cookie } = await flow();
    tokenSuccess();
    expect((await call('callback', { query: { state, code: 'code' }, headers: { cookie } })).statusCode).toBe(303);
    expect(db.connections.get(USER).selected_calendar_ids).toEqual(selected);
    expect((await call('status')).body.selectedCalendarIds).toEqual(selected);
  });
  it('does not import a default calendar for an explicit empty selection', async () => {
    connected({ selected: [] });
    const res = await call('events', { query: range });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ events: [], selectedCalendarIds: [], partial: false, unavailableCalendars: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('returns healthy selected calendars while explicitly disclosing an unavailable one', async () => {
    connected({ selected: ['removed', 'primary'] });
    fetchImpl.mockResolvedValueOnce(googleResponse({ error: { message: 'private upstream details' } }, 404));
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [event] }));
    const res = await call('events', { query: range });
    expect(res.statusCode).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body).toMatchObject({ partial: true, selectedCalendarIds: ['removed', 'primary'],
      unavailableCalendars: [{ calendarId: 'removed', code: 'google_unavailable' }] });
    expect(JSON.stringify(res.body)).not.toContain('private upstream details');
    expect(db.connections.get(USER).selected_calendar_ids).toEqual(['removed', 'primary']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('discloses page-limited calendars without mixing truncated events into healthy availability', async () => {
    connected({ selected: ['large', 'primary'] });
    for (let index = 0; index < 5; index++) fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ ...event, id: 'truncated' }], nextPageToken: `page-${index}` }));
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [event] }));
    const res = await call('events', { query: range });
    expect(res.statusCode).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].calendarId).toBe('primary');
    expect(res.body.unavailableCalendars).toEqual([{ calendarId: 'large', code: 'pagination_limit' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
  it('paginates lists and events and filters cancelled events on every page', async () => {
    connected();
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ id: 'primary', summary: 'Work', description: 'private' }], nextPageToken: 'list-next' }));
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ id: 'secondary', summary: 'Home' }] }));
    const listed = await call('calendars');
    expect(listed.body.calendars).toHaveLength(2);
    expect(JSON.stringify(listed.body)).not.toContain('private');
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [event, { ...event, id: 'cancelled', status: 'cancelled' }], nextPageToken: 'events-next' }));
    fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ ...event, id: 'second', description: 'private', attendees: [{ email: 'private' }] }] }));
    const res = await call('events', { query: range });
    expect(res.body.events).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain('private');
    const url = new URL(fetchImpl.mock.calls[3][0]);
    expect(url.searchParams.get('pageToken')).toBe('events-next');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('showDeleted')).toBe('true');
    expect(url.searchParams.get('fields')).not.toContain('attendees');
  });
  it('fails explicitly rather than returning partial results beyond the page cap', async () => {
    connected();
    for (let index = 0; index < 5; index++) fetchImpl.mockResolvedValueOnce(googleResponse({ items: [event], nextPageToken: `page-${index}` }));
    const res = await call('events', { query: range });
    expect(res.body.code).toBe('pagination_limit');
    expect(res.body).not.toHaveProperty('events');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
  it('bounds retries on Google rate-limit failures and does not leak upstream errors', async () => {
    connected();
    fetchImpl.mockResolvedValue(googleResponse({ error: { message: 'secret-provider-message' } }, 429));
    const res = await call('events', { query: range });
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('google_rate_limited');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(res.body)).not.toContain('secret-provider-message');
  });
  it('preserves overlapping boundaries, all-day exclusive dates, transparency and instance identities', () => {
    const allDay = normalizeEvent({ id: 'daily', start: { date: '2026-10-05' }, end: { date: '2026-10-08' }, transparency: 'transparent' }, 'calendar-one');
    expect(allDay).toMatchObject({ start: '2026-10-05', end: '2026-10-08', allDay: true, title: 'Busy', transparency: 'transparent' });
    const one = normalizeEvent({ ...event, recurringEventId: 'recurring', originalStartTime: { dateTime: '2026-10-06T10:00:00Z' } }, 'calendar-one');
    const two = normalizeEvent({ ...event, recurringEventId: 'recurring', originalStartTime: { dateTime: '2026-10-07T10:00:00Z' } }, 'calendar-one');
    expect(one.id).not.toBe(two.id);
    expect(one.id).not.toBe(normalizeEvent(event, 'calendar-two').id);
    expect(normalizeEvent({ ...event, status: 'cancelled' }, 'calendar-one')).toBeNull();
  });

  describe('authenticated independent event mutations', () => {
    const requestId = '12345678-1234-4123-8123-123456789abc';
    const timed = { summary: 'Independent Google event', start: { dateTime: '2026-10-06T10:00:00Z', timeZone: 'Europe/London' },
      end: { dateTime: '2026-10-06T11:00:00Z', timeZone: 'Europe/London' } };
    const current = { ...event, summary: 'Original title', etag: '"version-one"', eventType: 'default',
      organizer: { self: true },
      description: 'Unrelated private description', attendees: [{ email: 'private@example.test' }],
      conferenceData: { conferenceId: 'preserved' } };
    const creation = (eventPayload = timed) => ({ calendarId: 'primary', requestId, event: eventPayload });
    const change = (eventPayload = { summary: 'Updated title' }) => ({ calendarId: 'primary', eventId: current.id,
      etag: current.etag, event: eventPayload });
    function role(accessRole = 'owner', extra = {}) {
      fetchImpl.mockResolvedValueOnce(googleResponse({ items: [{ id: 'primary', primary: true, timeZone: 'Europe/London', accessRole, ...extra }] }));
    }
    function getEvent(extra = {}) {
      fetchImpl.mockResolvedValueOnce(googleResponse({ ...current, ...extra }));
    }
    beforeEach(() => connected({ scopes: GOOGLE_CALENDAR_SCOPES }));

    it('requests only event CRUD and calendar-list readonly scopes', () => {
      expect(GOOGLE_CALENDAR_SCOPES).toEqual(['https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly']);
    });
    it('persists granted scopes within encrypted tokens and reports upgrade eligibility', async () => {
      const { state, cookie } = await flow();
      tokenSuccess();
      await call('callback', { query: { state, code: 'code' }, headers: { cookie } });
      expect(decrypt(db.connections.get(USER).tokens_encrypted, KEY, `tokens:${USER}`).scopes).toEqual(GOOGLE_CALENDAR_SCOPES);
      expect(JSON.stringify(db.connections.get(USER))).not.toContain('calendar.events');
      expect((await call('status')).body).toMatchObject({ canWrite: true, needsUpgrade: false });
    });
    it.each([undefined, ['https://www.googleapis.com/auth/calendar.events.readonly', GOOGLE_CALENDAR_SCOPES[1]],
      [GOOGLE_CALENDAR_SCOPES[0]], ['https://www.googleapis.com/auth/calendar']])('rejects legacy or insufficient scopes: %j', async (scopes) => {
      connected({ scopes });
      expect((await call('status')).body).toMatchObject({ canWrite: false, needsUpgrade: true });
      for (const action of ['create', 'update', 'delete']) {
        const res = await call(action, { body: action === 'create' ? creation() : change() });
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('permission_upgrade_required');
        expect(res.body.error).toMatch(/Reconnect/);
      }
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('retains legacy read viewing after a scope-less refresh without elevating permissions', async () => {
      connected({ expired: true });
      tokenSuccess({ scope: undefined, refresh_token: undefined });
      fetchImpl.mockResolvedValueOnce(googleResponse({ accessRole: 'owner', items: [current] }));
      const res = await call('events', { query: range });
      expect(res.body.events[0]).toMatchObject({ editable: false, eventId: current.id, etag: current.etag });
      expect((await call('status')).body).toMatchObject({ needsUpgrade: true, canWrite: false });
    });
    it('preserves write scopes on a scope-less refresh', async () => {
      connected({ scopes: GOOGLE_CALENDAR_SCOPES, expired: true });
      tokenSuccess({ scope: undefined, refresh_token: undefined });
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse({ ...current, summary: 'Updated title' }));
      expect((await call('update', { body: change() })).statusCode).toBe(200);
      expect(decrypt(db.connections.get(USER).tokens_encrypted, KEY, `tokens:${USER}`).scopes).toEqual(GOOGLE_CALENDAR_SCOPES);
    });
    it.each(['reader', 'freeBusyReader', 'none', 'writerWithoutPrivateAccess', undefined])('denies a fresh non-writing role: %s', async (accessRole) => {
      role(accessRole === undefined ? null : accessRole);
      const res = await call('create', { body: creation() });
      expect(res.body.code).toBe('calendar_read_only');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    it.each(['writer', 'owner'])('creates on a fresh %s calendar with a deterministic provider-safe ID', async (accessRole) => {
      role(accessRole);
      fetchImpl.mockImplementationOnce(async (_url, options) => googleResponse({ ...JSON.parse(options.body), etag: '"created"',
        organizer: { self: true } }));
      const res = await call('create', { body: { ...creation(), user_id: OTHER, commitmentId: 'ignored-local-id' } });
      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(fetchImpl.mock.calls[1][1].body);
      expect(payload.id).toMatch(/^[a-v0-9]{65}$/);
      expect(payload).toMatchObject({ summary: timed.summary, start: timed.start, end: timed.end });
      expect(payload).not.toHaveProperty('commitmentId');
      expect(res.body.event).toMatchObject({ eventId: payload.id, calendarId: 'primary', title: timed.summary, editable: true,
        timeZone: 'Europe/London', etag: '"created"', recurringEventId: null });
      expect(JSON.stringify(res.body)).not.toContain('retaliateRequest');
      expect(db.operations.every((operation) => operation.table.startsWith('today_v2_google_'))).toBe(true);
      expect(db.operations.filter((operation) => operation.action !== 'select')).toHaveLength(0);
    });
    it('recognizes the primary alias from a calendar list containing its actual email ID', async () => {
      role('owner', { id: 'owner@example.test' });
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse(current));
      expect((await call('update', { body: change() })).statusCode).toBe(200);
    });
    it('never borrows another authenticated user connection or credentials', async () => {
      connected({ userId: OTHER, scopes: GOOGLE_CALENDAR_SCOPES });
      db.connections.delete(USER);
      const res = await call('update', { body: { ...change(), user_id: OTHER } });
      expect(res.body.code).toBe('not_connected');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(db.connections.has(OTHER)).toBe(true);
    });
    it('never trusts a client-provided writing role for an absent calendar', async () => {
      role('owner', { id: 'different-calendar' });
      expect((await call('create', { body: { ...creation(), calendarId: 'unavailable', accessRole: 'owner' } })).body.code).toBe('calendar_read_only');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    it.each(['create', 'update', 'delete'])('enforces POST and same-origin for %s', async (action) => {
      expect((await call(action, { method: 'GET' })).statusCode).toBe(405);
      expect((await call(action, { headers: { origin: 'https://attacker.test' }, body: creation() })).statusCode).toBe(403);
      db.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } });
      expect((await call(action, { body: creation() })).statusCode).toBe(401);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('uses a time-only PATCH and a fetched version without replacing unrelated fields', async () => {
      role();
      getEvent();
      const eventPatch = { end: { dateTime: '2026-10-06T12:00:00Z', timeZone: 'Europe/London' } };
      fetchImpl.mockResolvedValueOnce(googleResponse({ ...current, ...eventPatch }));
      const res = await call('update', { body: change(eventPatch) });
      expect(res.statusCode).toBe(200);
      expect(fetchImpl.mock.calls[1][1].method).toBe('GET');
      const options = fetchImpl.mock.calls[2][1];
      expect(options.method).toBe('PATCH');
      expect(options.headers['If-Match']).toBe(current.etag);
      expect(JSON.parse(options.body)).toEqual(eventPatch);
      expect(JSON.stringify(res.body)).not.toContain('Unrelated private');
      expect(res.body.event.end).toBe(eventPatch.end.dateTime);
    });
    it('uses a fetched etag even when the caller does not supply one', async () => {
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse(current));
      const body = change();
      delete body.etag;
      expect((await call('update', { body })).statusCode).toBe(200);
      expect(fetchImpl.mock.calls[2][1].headers['If-Match']).toBe(current.etag);
    });
    it('rejects a stale client etag before sending a mutation', async () => {
      role();
      getEvent({ etag: '"new-version"' });
      expect((await call('update', { body: change() })).body.code).toBe('event_conflict');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    it('refuses a provider response without an etag', async () => {
      role();
      getEvent({ etag: undefined });
      expect((await call('delete', { body: change() })).statusCode).toBe(502);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    it.each([
      { locked: true }, { recurrence: ['RRULE:FREQ=DAILY'] }, { eventType: 'birthday' },
      { eventType: 'outOfOffice' }, { eventType: 'focusTime' }, { eventType: 'workingLocation' }, { status: 'cancelled' },
    ])('rejects locked, special, cancelled and whole-series events: %j', async (extra) => {
      for (const action of ['update', 'delete']) {
        role();
        getEvent(extra);
        expect((await call(action, { body: change() })).body.code).toBe('event_not_editable');
      }
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });
    it.each(['update', 'delete'])('mutates only a recurring instance ID for %s', async (action) => {
      const instance = { ...current, id: 'series_20261006T100000Z', recurringEventId: 'series',
        originalStartTime: current.start };
      role();
      getEvent(instance);
      const json = vi.fn(async () => { throw new Error('204 has no JSON'); });
      fetchImpl.mockResolvedValueOnce(action === 'delete' ? { ok: true, status: 204, json } : googleResponse(instance));
      const res = await call(action, { body: { ...change(), eventId: instance.id } });
      expect(res.statusCode).toBe(200);
      expect(fetchImpl.mock.calls[2][0]).toContain(`/events/${instance.id}`);
      expect(fetchImpl.mock.calls[2][1].headers['If-Match']).toBe(current.etag);
      if (action === 'delete') {
        expect(res.body).toEqual({ deleted: true, calendarId: 'primary', eventId: instance.id });
        expect(json).not.toHaveBeenCalled();
      } else expect(res.body.event.recurringEventId).toBe('series');
    });
    it('creates and patches all-day events with exclusive end dates', async () => {
      const allDay = { summary: 'All-day', start: { date: '2028-02-29' }, end: { date: '2028-03-01' } };
      role();
      fetchImpl.mockImplementationOnce(async (_url, options) => googleResponse(JSON.parse(options.body)));
      const created = await call('create', { body: creation(allDay) });
      expect(created.body.event).toMatchObject({ allDay: true, start: '2028-02-29', end: '2028-03-01' });
      role();
      getEvent(allDay);
      fetchImpl.mockResolvedValueOnce(googleResponse({ ...current, ...allDay, end: { date: '2028-03-02' } }));
      const patched = await call('update', { body: change({ end: { date: '2028-03-02' } }) });
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toEqual({ end: { date: '2028-03-02' } });
    });
    it.each([
      { summary: '' }, { summary: 'x'.repeat(1025) }, { summary: 'bad\nname' }, { summary: null },
      { recurrence: ['RRULE:FREQ=DAILY'] }, { attendees: [] }, { description: 'not allowed' },
      { start: null }, { start: { date: '2026-02-29' } }, { start: { date: '2026-04-31' } },
      { start: { date: '0000-01-01' } }, { start: { date: '2026-10-06', dateTime: timed.start.dateTime } },
      { start: { dateTime: '2026-02-30T10:00:00Z' } }, { start: { dateTime: '2026-10-06T24:00:00Z' } },
      { start: { dateTime: '2026-10-06T10:60:00Z' } }, { start: { dateTime: '2026-10-06T10:00:60Z' } },
      { start: { dateTime: '2026-10-06T10:00:00+24:00' } }, { start: { dateTime: '2026-10-06T10:00:00' } },
      { start: { ...timed.start, timeZone: 'Imaginary/City' } }, { start: { ...timed.start, timeZone: '+01:00' } },
      { end: timed.start }, { end: { dateTime: '2026-11-06T10:00:00Z' } }, { end: { date: '2026-10-07' } },
    ])('rejects unsafe or invalid event payloads before creating: %j', async (extra) => {
      expect((await call('create', { body: creation({ ...timed, ...extra }) })).body.code).toBe('invalid_event');
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    it.each(['', 'not-a-uuid', null, '12345678-1234-0123-8123-123456789abc'])('requires a creation UUID: %s', async (invalid) => {
      expect((await call('create', { body: { ...creation(), requestId: invalid } })).body.code).toBe('invalid_request_id');
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    it.each([{ calendarId: 'calendar with spaces' }, { calendarId: 'id\ninjected' }, { eventId: 'id/escape' }, { eventId: '' },
      { etag: '"version"\r\ninjected' }])('rejects invalid IDs and etags: %j', async (extra) => {
      expect((await call('update', { body: { ...change(), ...extra } })).statusCode).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('allows opaque Google calendar IDs while encoding URL components and verifying fresh roles', async () => {
      const calendarId = 'team#calendar/opaque?name@example.test';
      role('writer', { id: calendarId });
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse(current));
      expect((await call('update', { body: { ...change(), calendarId } })).statusCode).toBe(200);
      expect(fetchImpl.mock.calls[1][0]).toContain(`/calendars/${encodeURIComponent(calendarId)}/events/`);
      expect(fetchImpl.mock.calls[2][0]).toContain(`/calendars/${encodeURIComponent(calendarId)}/events/`);
    });
    it.each([undefined, false])('does not advertise or mutate invited events without guest permission: %s', async (guestsCanModify) => {
      const invited = { ...current, organizer: { self: false }, guestsCanModify };
      fetchImpl.mockResolvedValueOnce(googleResponse({ accessRole: 'owner', items: [invited] }));
      const listed = await call('events', { query: range });
      expect(listed.body.events[0].editable).toBe(false);
      const fields = new URL(fetchImpl.mock.calls[0][0]).searchParams.get('fields');
      expect(fields).toContain('organizer(self)');
      expect(fields).toContain('guestsCanModify');
      for (const action of ['update', 'delete']) {
        role();
        getEvent(invited);
        expect((await call(action, { body: change() })).body.code).toBe('event_not_editable');
      }
      expect(fetchImpl).toHaveBeenCalledTimes(5);
    });
    it.each([{ organizer: { self: true }, guestsCanModify: false },
      { organizer: { self: false }, guestsCanModify: true }, {}])('allows verified organizers or explicitly editable invitations: %j', async (extra) => {
      const allowed = { ...current, ...extra };
      fetchImpl.mockResolvedValueOnce(googleResponse({ accessRole: 'owner', items: [allowed] }));
      expect((await call('events', { query: range })).body.events[0].editable).toBe(true);
      role();
      getEvent(allowed);
      fetchImpl.mockResolvedValueOnce(googleResponse(allowed));
      expect((await call('update', { body: change() })).statusCode).toBe(200);
    });
    it.each([undefined, {}, { email: 'other@example.test' }])('conservatively rejects missing organizer ownership: %j', async (organizer) => {
      const unknownOwnership = { ...current, organizer };
      fetchImpl.mockResolvedValueOnce(googleResponse({ accessRole: 'owner', items: [unknownOwnership] }));
      expect((await call('events', { query: range })).body.events[0].editable).toBe(false);
      for (const action of ['update', 'delete']) {
        role();
        getEvent(unknownOwnership);
        expect((await call(action, { body: change() })).body.code).toBe('event_not_editable');
      }
      expect(fetchImpl).toHaveBeenCalledTimes(5);
    });
    it('allows explicitly modifiable guests even when organizer ownership is omitted', async () => {
      const allowed = { ...current, organizer: {}, guestsCanModify: true };
      fetchImpl.mockResolvedValueOnce(googleResponse({ accessRole: 'writer', items: [allowed] }));
      expect((await call('events', { query: range })).body.events[0].editable).toBe(true);
      role('writer');
      getEvent(allowed);
      fetchImpl.mockResolvedValueOnce(googleResponse(allowed));
      expect((await call('update', { body: change() })).statusCode).toBe(200);
    });
    it.each([403, 404, 410, 412])('returns safe mutation errors for provider status %s', async (status) => {
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: { message: 'secret-provider-details' } }, status));
      const res = await call('update', { body: change() });
      expect(res.statusCode).toBe(status);
      expect(res.body.code).toBe({ 403: 'calendar_read_only', 404: 'event_not_found', 410: 'event_gone', 412: 'event_conflict' }[status]);
      expect(JSON.stringify(res.body)).not.toContain('secret-provider-details');
    });
    it('refreshes a rejected credential once and reuses the same conditional mutation', async () => {
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
      tokenSuccess({ refresh_token: undefined, scope: undefined });
      fetchImpl.mockResolvedValueOnce(googleResponse(current));
      expect((await call('update', { body: change() })).statusCode).toBe(200);
      expect(fetchImpl.mock.calls[4][1].headers).toMatchObject({ 'If-Match': current.etag,
        Authorization: ['Bearer', 'new-google-access-value'].join(' ') });
    });
    it('removes only this user connection after revocation during a write', async () => {
      connected({ userId: OTHER, scopes: GOOGLE_CALENDAR_SCOPES });
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: 'invalid_grant' }, 400));
      const res = await call('update', { body: change() });
      expect(res.body.code).toBe('reconnect_required');
      expect(db.connections.has(USER)).toBe(false);
      expect(db.connections.has(OTHER)).toBe(true);
    });
    it('requires a permission upgrade if a forced refresh removes event editing scope', async () => {
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
      tokenSuccess({ refresh_token: undefined, scope: ['https://www.googleapis.com/auth/calendar.events.readonly',
        GOOGLE_CALENDAR_SCOPES[1]].join(' ') });
      const res = await call('update', { body: change() });
      expect(res.body.code).toBe('permission_upgrade_required');
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect((await call('status')).body).toMatchObject({ canWrite: false, needsUpgrade: true });
    });
    it('requires reconnection after a newly refreshed credential is rejected during a mutation', async () => {
      role();
      getEvent();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
      tokenSuccess({ refresh_token: undefined });
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 401));
      expect((await call('update', { body: change() })).body.code).toBe('reconnect_required');
      expect(db.connections.has(USER)).toBe(false);
    });
    it.each([404, 410])('stops before mutating when the fetched event returns %s', async (status) => {
      role();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: { message: 'private' } }, status));
      expect((await call('delete', { body: change() })).statusCode).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    it('rejects a fetched ID that does not match the requested event', async () => {
      role();
      getEvent({ id: 'another-event' });
      expect((await call('delete', { body: change() })).body.code).toBe('event_not_editable');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    it('does not report successful creation for an incomplete provider response', async () => {
      role();
      fetchImpl.mockResolvedValueOnce(googleResponse({}));
      expect((await call('create', { body: creation() })).statusCode).toBe(502);
    });
    it('reconciles retries only after checking the existing private request marker', async () => {
      let created;
      role();
      fetchImpl.mockImplementationOnce(async (_url, options) => {
        created = { ...JSON.parse(options.body), etag: '"created"' };
        return googleResponse(created);
      });
      const first = await call('create', { body: creation() });
      role();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 409));
      fetchImpl.mockImplementationOnce(async () => googleResponse(created));
      const retry = await call('create', { body: creation() });
      expect(retry.body).toEqual(first.body);
      expect(JSON.parse(fetchImpl.mock.calls[3][1].body).id).toBe(created.id);
      expect(fetchImpl.mock.calls[4][1].method).toBe('GET');
      role();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 409));
      fetchImpl.mockImplementationOnce(async () => googleResponse({ ...created, extendedProperties: { private: { retaliateRequest: 'other-user' } } }));
      expect((await call('create', { body: creation() })).body.code).toBe('request_conflict');
    });
    it('binds creation IDs to the authenticated user even on a shared calendar', async () => {
      const ids = [];
      for (const userId of [USER, OTHER]) {
        connected({ userId, scopes: GOOGLE_CALENDAR_SCOPES });
        db.auth.getUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
        role();
        fetchImpl.mockImplementationOnce(async (_url, options) => {
          const created = JSON.parse(options.body);
          ids.push(created.id);
          return googleResponse(created);
        });
        expect((await call('create', { body: creation() })).statusCode).toBe(200);
      }
      expect(ids[0]).not.toBe(ids[1]);
    });
    it('does not duplicate a retried request when the caller changes its title', async () => {
      let created;
      role();
      fetchImpl.mockImplementationOnce(async (_url, options) => {
        created = JSON.parse(options.body);
        return googleResponse(created);
      });
      await call('create', { body: creation() });
      role();
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 409));
      fetchImpl.mockImplementationOnce(async () => googleResponse(created));
      const res = await call('create', { body: creation({ ...timed, summary: 'Changed on retry' }) });
      expect(res.body.event.title).toBe(timed.summary);
      expect(fetchImpl.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(0);
    });
    it('exposes writing roles only together with granted editing scopes in calendar choices', async () => {
      role('writer');
      expect((await call('calendars')).body.calendars[0]).toMatchObject({ accessRole: 'writer', canWrite: true });
      connected();
      role('owner');
      expect((await call('calendars')).body.calendars[0]).toMatchObject({ accessRole: 'owner', canWrite: false });
    });
    it('reconciles a provider retry after an ambiguous server failure without duplicate creation', async () => {
      let created;
      role();
      fetchImpl.mockImplementationOnce(async (_url, options) => {
        created = JSON.parse(options.body);
        return googleResponse({ error: {} }, 503);
      });
      fetchImpl.mockResolvedValueOnce(googleResponse({ error: {} }, 409));
      fetchImpl.mockImplementationOnce(async () => googleResponse(created));
      expect((await call('create', { body: creation() })).body.event.eventId).toBe(created.id);
      expect(JSON.parse(fetchImpl.mock.calls[1][1].body).id).toBe(JSON.parse(fetchImpl.mock.calls[2][1].body).id);
      expect(sleep).toHaveBeenCalledTimes(1);
    });
    it.each(['owner', 'writer', 'reader', 'freeBusyReader'])('combines fresh events-list role %s with scope and event eligibility', async (accessRole) => {
      fetchImpl.mockResolvedValueOnce(googleResponse({ accessRole, timeZone: 'America/New_York',
        items: [current, { ...current, id: 'locked', locked: true }, { ...current, id: 'special', eventType: 'focusTime' },
          { ...current, id: 'master', recurrence: ['RRULE:FREQ=DAILY'] },
          { ...current, id: 'instance', recurringEventId: 'master', originalStartTime: { dateTime: '2026-10-07T10:00:00Z' } }] }));
      const res = await call('events', { query: range });
      expect(res.body.events.map((item) => item.editable)).toEqual([
        ['owner', 'writer'].includes(accessRole), false, false, false, ['owner', 'writer'].includes(accessRole),
      ]);
      expect(res.body.events[0].timeZone).toBe('America/New_York');
    });
  });
});
