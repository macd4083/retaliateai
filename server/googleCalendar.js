import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const CONNECTIONS = 'today_v2_google_connections';
const STATES = 'today_v2_google_oauth_states';
const COOKIE = '__Host-google-calendar-nonce';
const DEV_COOKIE = 'google-calendar-nonce';
const MAX_CALENDARS = 10;
const MAX_PAGES = 5;
const STATE_LIFETIME = 10 * 60 * 1000;
const METHODS = { status: 'GET', connect: 'POST', callback: 'GET', calendars: 'GET', select: 'POST', events: 'GET', disconnect: 'POST' };

class CalendarError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new CalendarError(status, code, message); };
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function encryptionKey(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    fail(503, 'not_configured', 'Google Calendar encryption key must be base64-encoded 32 bytes.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) fail(503, 'not_configured', 'Google Calendar encryption key must be base64-encoded 32 bytes.');
  return key;
}

export function encrypt(value, key, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decrypt(value, key, context) {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || extra !== undefined) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
  } catch {
    fail(503, 'storage_unavailable', 'Stored Google Calendar credentials could not be read. Reconnect your calendar.');
  }
}

function configuration(env) {
  const missing = ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REDIRECT_URI',
    'GOOGLE_CALENDAR_ENCRYPTION_KEY', 'APP_ORIGIN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !env[name]);
  if (missing.length) fail(503, 'not_configured', `Google Calendar is not configured. Missing: ${missing.join(', ')}.`);
  const key = encryptionKey(env.GOOGLE_CALENDAR_ENCRYPTION_KEY);
  try {
    const origin = new URL(env.APP_ORIGIN);
    const redirect = new URL(env.GOOGLE_CALENDAR_REDIRECT_URI);
    const localHttp = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
    if ((!localHttp && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash ||
      !['', '/'].includes(origin.pathname) || redirect.href !== `${origin.origin}/api/google-calendar?action=callback`) throw new Error();
    return { key, origin: origin.origin, redirect: redirect.href, clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
      clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET, secureCookies: !localHttp, cookieName: localHttp ? DEV_COOKIE : COOKIE };
  } catch {
    fail(503, 'not_configured', 'Use an HTTPS APP_ORIGIN (HTTP is allowed only on localhost or 127.0.0.1) and matching /api/google-calendar?action=callback redirect URI.');
  }
}

function cookieValue(req, config) {
  const raw = (req.headers?.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${config.cookieName}=`))?.slice(config.cookieName.length + 1);
  const [nonce, signature, extra] = (raw || '').split('.');
  if (extra || !nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) return null;
  const expected = createHmac('sha256', config.key).update(`google-calendar-browser:${nonce}`).digest('base64url');
  return equal(signature, expected) ? nonce : null;
}

function setCookie(res, nonce, config) {
  const signature = nonce ? createHmac('sha256', config.key).update(`google-calendar-browser:${nonce}`).digest('base64url') : '';
  res.setHeader('Set-Cookie', `${config.cookieName}=${nonce ? `${nonce}.${signature}` : ''}; Path=/; HttpOnly;${config.secureCookies ? ' Secure;' : ''} SameSite=Lax; Max-Age=${nonce ? STATE_LIFETIME / 1000 : 0}`);
}

function storage(result) {
  if (result.error) fail(503, 'storage_unavailable', 'Google Calendar storage is unavailable. Apply the Google Calendar database migration.');
  return result.data;
}

export function normalizeEvent(event, calendarId) {
  if (event.status === 'cancelled' || !event.id || !event.start || !event.end) return null;
  const start = event.start.dateTime || event.start.date;
  const end = event.end.dateTime || event.end.date;
  if (!start || !end) return null;
  const instance = event.originalStartTime?.dateTime || event.originalStartTime?.date || start;
  return {
    id: JSON.stringify([calendarId, event.recurringEventId || event.id, instance]),
    calendarId,
    title: typeof event.summary === 'string' && event.summary.trim() ? event.summary : 'Busy',
    start, end,
    allDay: Boolean(event.start.date && !event.start.dateTime),
    transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
  };
}

export function eventRange(timeMin, timeMax) {
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof timeMin !== 'string' || typeof timeMax !== 'string' || !timestamp.test(timeMin) || !timestamp.test(timeMax)) {
    fail(400, 'invalid_range', 'timeMin and timeMax must be ISO timestamps with time zones.');
  }
  const start = Date.parse(timeMin);
  const end = Date.parse(timeMax);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 48 * 60 * 60 * 1000) {
    fail(400, 'invalid_range', 'Event range must be positive and no longer than 48 hours.');
  }
  return { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() };
}

export function createGoogleCalendarHandler({ env = process.env, supabase, fetchImpl = globalThis.fetch,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let client = supabase;
  function database() {
    if (!client) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) fail(503, 'not_configured', 'Supabase server authentication is not configured.');
      client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    return client;
  }

  async function googleRequest(url, options, deadline) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) fail(504, 'google_timeout', 'Google Calendar request timed out. Try again later.');
      let response;
      let body;
      try {
        response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(Math.min(8000, remaining)), redirect: 'error' });
        body = await response.json();
      } catch {
        fail(502, 'google_unavailable', 'Google Calendar is temporarily unavailable.');
      }
      const rateLimited = response.status === 429 || (response.status === 403 &&
        body.error?.errors?.some((error) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(error.reason)));
      if ((rateLimited || response.status >= 500) && attempt < 2) {
        await sleep(Math.min(1000, 250 * 2 ** attempt));
        continue;
      }
      if (!response.ok) {
        if (body.error === 'invalid_grant' || response.status === 401) fail(401, 'reconnect_required', 'Google Calendar authorization expired or was revoked. Reconnect your calendar.');
        if (rateLimited) fail(429, 'google_rate_limited', 'Google Calendar rate limit reached. Try again later.');
        fail(502, 'google_unavailable', 'Google Calendar could not complete the request.');
      }
      return body;
    }
  }

  function tokenRequest(parameters, config, deadline) {
    return googleRequest('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
    }, deadline);
  }

  async function connection(userId) {
    return storage(await database().from(CONNECTIONS).select('tokens_encrypted,selected_calendar_ids').eq('user_id', userId).maybeSingle());
  }

  async function saveTokens(userId, tokens, config, selectedIds) {
    const values = { user_id: userId, tokens_encrypted: encrypt(tokens, config.key, `tokens:${userId}`), updated_at: new Date(now()).toISOString() };
    if (selectedIds !== undefined) values.selected_calendar_ids = selectedIds;
    storage(await database().from(CONNECTIONS).upsert(values, { onConflict: 'user_id' }));
  }

  function mergeTokens(body, previous = {}) {
    if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) {
      fail(502, 'google_unavailable', 'Google returned incomplete credentials.');
    }
    if (body.scope && !GOOGLE_CALENDAR_SCOPES.every((scope) => body.scope.split(' ').includes(scope))) {
      fail(400, 'consent_required', 'Grant both read-only calendar permissions to connect.');
    }
    const refreshToken = body.refresh_token || previous.refresh_token;
    if (!refreshToken) fail(400, 'consent_required', 'Offline calendar permission was not granted. Reconnect and grant consent.');
    return { access_token: body.access_token, refresh_token: refreshToken, expires_at: now() + Number(body.expires_in) * 1000 };
  }

  async function access(userId, row, config, deadline, force = false) {
    if (!row) fail(409, 'not_connected', 'Connect Google Calendar first.');
    const previous = decrypt(row.tokens_encrypted, config.key, `tokens:${userId}`);
    if (!force && previous.access_token && previous.expires_at > now() + 60000) return previous.access_token;
    if (!previous.refresh_token) fail(401, 'reconnect_required', 'Reconnect Google Calendar.');
    try {
      const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: previous.refresh_token }, config, deadline);
      const tokens = mergeTokens(body, previous);
      // Update only an existing row: a concurrent disconnect must not be resurrected.
      const encrypted = encrypt(tokens, config.key, `tokens:${userId}`);
      storage(await database().from(CONNECTIONS).update({
        tokens_encrypted: encrypted, updated_at: new Date(now()).toISOString(),
      }).eq('user_id', userId).eq('tokens_encrypted', row.tokens_encrypted));
      row.tokens_encrypted = encrypted;
      return tokens.access_token;
    } catch (error) {
      if (error.code === 'reconnect_required') storage(await database().from(CONNECTIONS).delete().eq('user_id', userId).eq('tokens_encrypted', row.tokens_encrypted));
      throw error;
    }
  }

  async function paginated(path, parameters, userId, row, config, deadline) {
    let token = await access(userId, row, config, deadline);
    let refreshed = false;
    let pageToken;
    const items = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
      url.search = new URLSearchParams({ ...parameters, maxResults: '250', ...(pageToken ? { pageToken } : {}) }).toString();
      let body;
      try {
        body = await googleRequest(url.href, { headers: { Authorization: ['Bearer', token].join(' ') } }, deadline);
      } catch (error) {
        if (error.code !== 'reconnect_required' || refreshed) {
          if (error.code === 'reconnect_required') {
            storage(await database().from(CONNECTIONS).delete().eq('user_id', userId).eq('tokens_encrypted', row.tokens_encrypted));
          }
          throw error;
        }
        token = await access(userId, row, config, deadline, true);
        refreshed = true;
        try {
          body = await googleRequest(url.href, { headers: { Authorization: ['Bearer', token].join(' ') } }, deadline);
        } catch (retryError) {
          if (retryError.code === 'reconnect_required') {
            storage(await database().from(CONNECTIONS).delete().eq('user_id', userId).eq('tokens_encrypted', row.tokens_encrypted));
          }
          throw retryError;
        }
      }
      if (!Array.isArray(body.items) && body.items !== undefined) fail(502, 'google_unavailable', 'Google returned invalid calendar data.');
      items.push(...(body.items || []));
      if (!body.nextPageToken) return items;
      if (body.nextPageToken === pageToken) fail(502, 'pagination_limit', 'Google Calendar pagination could not complete.');
      pageToken = body.nextPageToken;
    }
    fail(502, 'pagination_limit', 'Calendar response exceeds the supported page limit. No partial results were returned.');
  }

  async function calendars(userId, row, config, deadline) {
    const items = await paginated('users/me/calendarList', { showHidden: 'false', showDeleted: 'false',
      fields: 'nextPageToken,items(id,summary,primary,backgroundColor,timeZone,deleted)' }, userId, row, config, deadline);
    return items.filter((item) => !item.deleted && typeof item.id === 'string').map((item) => ({
      id: item.id, name: item.summary || 'Calendar', primary: Boolean(item.primary),
      color: item.backgroundColor || null, timeZone: item.timeZone || null,
    }));
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const action = req.query?.action || req.body?.action;
    try {
      if (!Object.hasOwn(METHODS, action)) fail(400, 'invalid_action', 'Unknown Google Calendar action.');
      if (req.method !== METHODS[action]) {
        res.setHeader('Allow', METHODS[action]);
        fail(405, 'method_not_allowed', 'Method not allowed.');
      }
      const deadline = now() + 20000;
      let userId;
      if (action !== 'callback') {
        const authorization = req.headers?.authorization;
        const parts = typeof authorization === 'string' ? authorization.split(' ') : [];
        if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) fail(401, 'unauthorized', 'Sign in to use Google Calendar.');
        const { data, error } = await database().auth.getUser(authorization.slice(7));
        if (error || !data?.user?.id) fail(401, 'unauthorized', 'Sign in to use Google Calendar.');
        userId = data.user.id;
      }
      if (action === 'disconnect') {
        const row = await connection(userId);
        let revokeToken;
        try {
          if (row) {
            const tokens = decrypt(row.tokens_encrypted, encryptionKey(env.GOOGLE_CALENDAR_ENCRYPTION_KEY), `tokens:${userId}`);
            revokeToken = tokens.refresh_token || tokens.access_token;
          }
        } catch { /* Missing or rotated encryption configuration must not block local deletion. */ }
        storage(await database().from(CONNECTIONS).delete().eq('user_id', userId));
        storage(await database().from(STATES).delete().eq('user_id', userId));
        if (revokeToken) {
          try {
            await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: revokeToken }).toString(), signal: AbortSignal.timeout(3000) });
          } catch { /* Google revocation is best effort; local disconnection is authoritative. */ }
        }
        return res.status(200).json({ connected: false, selectedCalendarIds: [] });
      }
      let config;
      let configError;
      try { config = configuration(env); } catch (error) {
        if (action !== 'status') throw error;
        configError = error;
      }
      if (req.method === 'POST' && req.headers?.origin && req.headers.origin !== config.origin) fail(403, 'invalid_origin', 'Request origin is not allowed.');
      if (action === 'callback') {
        const nonce = cookieValue(req, config);
        setCookie(res, null, config);
        const state = req.query?.state;
        if (!nonce || typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) fail(400, 'invalid_state', 'Calendar authorization expired or did not originate in this browser.');
        const stateHash = hash(state);
        const pending = storage(await database().from(STATES).select('*').eq('state_hash', stateHash).maybeSingle());
        if (!pending || !Number.isFinite(Date.parse(pending.expires_at)) || Date.parse(pending.expires_at) <= now()) fail(400, 'invalid_state', 'Calendar authorization expired. Try connecting again.');
        const binding = decrypt(pending.verifier_encrypted, config.key, `state:${stateHash}`);
        if (!equal(binding.browser_hash, hash(nonce))) fail(400, 'invalid_state', 'Calendar authorization did not originate in this browser.');
        const consumed = storage(await database().rpc('today_v2_consume_google_state', { p_state_hash: stateHash }));
        const saved = Array.isArray(consumed) ? consumed[0] : consumed;
        if (!saved || saved.user_id !== pending.user_id || saved.verifier_encrypted !== pending.verifier_encrypted ||
          !Number.isFinite(Date.parse(saved.expires_at)) || Date.parse(saved.expires_at) <= now()) fail(400, 'invalid_state', 'Calendar authorization was already used or expired.');
        const returnPath = saved.return_path === '/settings' ? '/settings' : '/today';
        if (req.query?.error) return res.redirect(303, `${config.origin}${returnPath}?googleCalendar=denied`);
        if (typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) fail(400, 'invalid_callback', 'Google authorization code is missing.');
        const previous = await connection(saved.user_id);
        let oldTokens = {};
        if (previous) {
          try { oldTokens = decrypt(previous.tokens_encrypted, config.key, `tokens:${saved.user_id}`); }
          catch { /* Fresh offline consent can repair credentials encrypted with a lost or rotated key. */ }
        }
        const previousIds = previous?.selected_calendar_ids;
        const selectedIds = Array.isArray(previousIds) && previousIds.length <= MAX_CALENDARS &&
          previousIds.every((id) => typeof id === 'string' && id && id.length <= 1024) &&
          new Set(previousIds).size === previousIds.length ? previousIds : [];
        const body = await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: config.redirect, code_verifier: binding.verifier }, config, deadline);
        await saveTokens(saved.user_id, mergeTokens(body, oldTokens), config, selectedIds);
        return res.redirect(303, `${config.origin}${returnPath}?googleCalendar=connected`);
      }
      if (action === 'status') {
        let row;
        try {
          row = await connection(userId);
          storage(await database().from(STATES).select('state_hash').limit(0));
          storage(await database().rpc('today_v2_consume_google_state', { p_state_hash: hash(randomBytes(32)) }));
          return res.status(200).json({ configured: Boolean(config), schemaAvailable: true, connected: Boolean(row),
            selectedCalendarIds: row?.selected_calendar_ids || [], ...(configError ? { message: configError.message } : {}) });
        } catch {
          return res.status(200).json({ configured: Boolean(config), schemaAvailable: false, connected: Boolean(row),
            selectedCalendarIds: row?.selected_calendar_ids || [],
            message: configError?.message || 'Google Calendar storage is unavailable. Apply the Google Calendar database migration.' });
        }
      }
      if (action === 'connect') {
        const submittedPath = req.body?.returnPath;
        if (submittedPath !== undefined && !['/today', '/settings'].includes(submittedPath)) {
          fail(400, 'invalid_return_path', 'Return path must be /today or /settings.');
        }
        const returnPath = submittedPath || '/today';
        const state = randomBytes(32).toString('base64url');
        const nonce = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        const stateHash = hash(state);
        // Bound the number of pending authorizations per user and remove abandoned flows.
        storage(await database().from(STATES).delete().eq('user_id', userId));
        storage(await database().from(STATES).insert({ state_hash: stateHash, user_id: userId,
          expires_at: new Date(now() + STATE_LIFETIME).toISOString(), return_path: returnPath,
          verifier_encrypted: encrypt({ verifier, browser_hash: hash(nonce) }, config.key, `state:${stateHash}`) }));
        setCookie(res, nonce, config);
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect,
          response_type: 'code', scope: GOOGLE_CALENDAR_SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
          state, code_challenge: hash(verifier), code_challenge_method: 'S256' }).toString();
        return res.status(200).json({ authorizationUrl: url.href });
      }
      const row = await connection(userId);
      if (action === 'calendars') return res.status(200).json({ calendars: await calendars(userId, row, config, deadline), selectedCalendarIds: row?.selected_calendar_ids || [] });
      if (action === 'select') {
        const ids = req.body?.calendarIds;
        if (!Array.isArray(ids) || ids.length > MAX_CALENDARS || ids.some((id) => typeof id !== 'string' || !id || id.length > 1024) || new Set(ids).size !== ids.length) {
          fail(400, 'invalid_selection', 'Select up to 10 distinct calendars.');
        }
        if (!row) fail(409, 'not_connected', 'Connect Google Calendar first.');
        if (ids.length) {
          const available = new Set((await calendars(userId, row, config, deadline)).map((calendar) => calendar.id));
          if (ids.some((id) => !available.has(id))) fail(400, 'invalid_selection', 'Select only calendars in your Google calendar list.');
        }
        storage(await database().from(CONNECTIONS).update({ selected_calendar_ids: ids, updated_at: new Date(now()).toISOString() }).eq('user_id', userId));
        return res.status(200).json({ selectedCalendarIds: ids });
      }
      const range = eventRange(req.query?.timeMin, req.query?.timeMax);
      if (!row) fail(409, 'not_connected', 'Connect Google Calendar first.');
      const selected = row.selected_calendar_ids || [];
      if (!Array.isArray(selected) || selected.length > MAX_CALENDARS || selected.some((id) => typeof id !== 'string' || !id)) fail(400, 'invalid_selection', 'Select up to 10 calendars again.');
      const events = [];
      for (const id of selected) {
        const items = await paginated(`calendars/${encodeURIComponent(id)}/events`, { ...range, singleEvents: 'true', showDeleted: 'true',
          fields: 'nextPageToken,items(id,recurringEventId,originalStartTime,start,end,summary,status,transparency)' }, userId, row, config, deadline);
        events.push(...items.map((event) => normalizeEvent(event, id)).filter(Boolean));
      }
      return res.status(200).json({ events: [...new Map(events.map((event) => [event.id, event])).values()], ...range });
    } catch (error) {
      const safe = error instanceof CalendarError ? error : new CalendarError(500, 'internal_error', 'Google Calendar request could not be completed.');
      return res.status(safe.status).json({ error: safe.message, code: safe.code });
    }
  };
}
