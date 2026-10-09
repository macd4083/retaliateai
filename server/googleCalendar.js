import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const CONNECTIONS = 'today_v2_google_connections';
const STATES = 'today_v2_google_oauth_states';
const COOKIE = '__Host-google-calendar-nonce';
const DEV_COOKIE = 'google-calendar-nonce';
const MAX_CALENDARS = 10;
const MAX_PAGES = 5;
const STATE_LIFETIME = 10 * 60 * 1000;
const METHODS = { status: 'GET', connect: 'POST', callback: 'GET', calendars: 'GET', select: 'POST', events: 'GET', disconnect: 'POST',
  create: 'POST', update: 'POST', delete: 'POST' };

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

const writeScopes = (tokens) => Array.isArray(tokens?.scopes) && GOOGLE_CALENDAR_SCOPES.every((scope) => tokens.scopes.includes(scope));
const writableRole = (role) => ['writer', 'owner'].includes(role);
const mutableEvent = (event) => event.status !== 'cancelled' && !event.locked &&
  (!event.eventType || event.eventType === 'default') && !event.recurrence?.length &&
  (event.organizer?.self === true || event.guestsCanModify === true);

export function normalizeEvent(event, calendarId, { canWrite = false, accessRole, timeZone } = {}) {
  if (event.status === 'cancelled' || !event.id || !event.start || !event.end) return null;
  const start = event.start.dateTime || event.start.date;
  const end = event.end.dateTime || event.end.date;
  if (!start || !end) return null;
  const instance = event.originalStartTime?.dateTime || event.originalStartTime?.date || start;
  return {
    id: JSON.stringify([calendarId, event.recurringEventId || event.id, instance]),
    calendarId,
    eventId: event.id,
    timeZone: event.start.timeZone || timeZone || null,
    editable: canWrite && writableRole(accessRole) && mutableEvent(event),
    etag: event.etag || null,
    recurringEventId: event.recurringEventId || null,
    title: typeof event.summary === 'string' && event.summary.trim() ? event.summary : 'Busy',
    start, end,
    allDay: Boolean(event.start.date && !event.start.dateTime),
    transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
  };
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function eventBoundary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_event', 'Supply a Google Calendar start and end.');
  if (Object.hasOwn(value, 'date')) {
    if (Object.keys(value).some((key) => key !== 'date') || !validDate(value.date)) {
      fail(400, 'invalid_event', 'All-day dates must be real YYYY-MM-DD dates with an exclusive end.');
    }
    return { value: { date: value.date }, instant: Date.parse(`${value.date}T00:00:00Z`), allDay: true };
  }
  const match = typeof value.dateTime === 'string' &&
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value.dateTime);
  if (Object.keys(value).some((key) => !['dateTime', 'timeZone'].includes(key)) ||
    !match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 ||
    Number(match[6] || 0) > 23 || Number(match[7] || 0) > 59 || !Number.isFinite(Date.parse(value.dateTime))) {
    fail(400, 'invalid_event', 'Timed events require real RFC3339 timestamps with an explicit UTC offset.');
  }
  if (Object.hasOwn(value, 'timeZone')) {
    try {
      if (typeof value.timeZone !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value.timeZone)) throw new Error();
      new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format();
    } catch { fail(400, 'invalid_event', 'Use a valid IANA time zone.'); }
  }
  return { value: { dateTime: value.dateTime, ...(value.timeZone ? { timeZone: value.timeZone } : {}) },
    instant: Date.parse(value.dateTime), allDay: false };
}

function eventPayload(input, existing) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length ||
    Object.keys(input).some((key) => !['summary', 'start', 'end'].includes(key))) {
    fail(400, 'invalid_event', 'Only summary, start and end may be changed.');
  }
  const patch = {};
  if (!existing || Object.hasOwn(input, 'summary')) {
    if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 1024 ||
      /[\u0000-\u001f\u007f]/.test(input.summary)) fail(400, 'invalid_event', 'Supply a title of 1–1024 characters.');
    patch.summary = input.summary.trim();
  }
  const start = eventBoundary(Object.hasOwn(input, 'start') ? input.start : existing?.start);
  const end = eventBoundary(Object.hasOwn(input, 'end') ? input.end : existing?.end);
  if (start.allDay !== end.allDay || end.instant <= start.instant || end.instant - start.instant >= 31 * 86400000) {
    fail(400, 'invalid_event', 'Start and end must have matching types and a positive duration shorter than 31 days.');
  }
  if (Object.hasOwn(input, 'start') || !existing) patch.start = start.value;
  if (Object.hasOwn(input, 'end') || !existing) patch.end = end.value;
  return patch;
}

function mutationIds(body, needsEvent) {
  if (typeof body?.calendarId !== 'string' || !body.calendarId || body.calendarId.length > 1024 ||
    /[\s\u0000-\u001f\u007f]/.test(body.calendarId) ||
    (needsEvent && (typeof body.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(body.eventId)))) {
    fail(400, 'invalid_id', 'Supply valid Google calendar and event IDs.');
  }
  if (body.etag !== undefined && (typeof body.etag !== 'string' || !/^"[^"\u0000-\u001f\u007f]{1,250}"$/.test(body.etag))) {
    fail(400, 'invalid_event', 'Supply the event version returned by Google Calendar.');
  }
}

export function eventRange(timeMin, timeMax) {
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof timeMin !== 'string' || typeof timeMax !== 'string' || !timestamp.test(timeMin) || !timestamp.test(timeMax)) {
    fail(400, 'invalid_range', 'timeMin and timeMax must be ISO timestamps with time zones.');
  }
  const start = Date.parse(timeMin);
  const end = Date.parse(timeMax);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 49 * 60 * 60 * 1000) {
    fail(400, 'invalid_range', 'Event range must be positive and no longer than 49 hours.');
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

  async function googleRequest(url, options, deadline, mutation = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) fail(504, 'google_timeout', 'Google Calendar request timed out. Try again later.');
      let response;
      let body;
      try {
        response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(Math.min(8000, remaining)), redirect: 'error' });
        body = response.status === 204 ? {} : await response.json();
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
        if (mutation) {
          const errors = {
            403: ['calendar_read_only', 'Google Calendar denied this change. Check calendar permissions or reconnect.'],
            404: ['event_not_found', 'The calendar or event is no longer available. Refresh your calendar.'],
            409: ['request_conflict', 'This creation request conflicts with an existing event.'],
            410: ['event_gone', 'This event has been removed. Refresh your calendar.'],
            412: ['event_conflict', 'This event changed in Google Calendar. Refresh before trying again.'],
          };
          if (errors[response.status]) fail(response.status, ...errors[response.status]);
        }
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

  async function revoke(token) {
    if (!token) return;
    try {
      await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(3000) });
    } catch { /* Revocation is best effort; local deletion or atomic finalization is authoritative. */ }
  }

  function mergeTokens(body, previous = {}, authorization = false) {
    if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) {
      fail(502, 'google_unavailable', 'Google returned incomplete credentials.');
    }
    const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) :
      (authorization ? [...GOOGLE_CALENDAR_SCOPES] : previous.scopes);
    if (scopes && (!scopes.includes(GOOGLE_CALENDAR_SCOPES[1]) ||
      !(scopes.includes(GOOGLE_CALENDAR_SCOPES[0]) || (!authorization && scopes.includes('https://www.googleapis.com/auth/calendar.events.readonly'))))) {
      fail(400, 'consent_required', 'Grant event and calendar-list permissions to connect.');
    }
    const refreshToken = body.refresh_token || previous.refresh_token;
    if (!refreshToken) fail(400, 'consent_required', 'Offline calendar permission was not granted. Reconnect and grant consent.');
    return { access_token: body.access_token, refresh_token: refreshToken, expires_at: now() + Number(body.expires_in) * 1000,
      ...(scopes ? { scopes } : {}) };
  }

  async function access(userId, row, config, deadline, force = false) {
    if (!row) fail(409, 'not_connected', 'Connect Google Calendar first.');
    let previous;
    try {
      previous = decrypt(row.tokens_encrypted, config.key, `tokens:${userId}`);
    } catch {
      fail(401, 'reconnect_required', 'Stored Google Calendar credentials could not be read. Reconnect your calendar.');
    }
    if (!previous || typeof previous !== 'object') fail(401, 'reconnect_required', 'Reconnect Google Calendar.');
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
      if (error.code === 'consent_required') error = new CalendarError(401, 'reconnect_required', error.message);
      if (error.code === 'reconnect_required') storage(await database().from(CONNECTIONS).delete().eq('user_id', userId).eq('tokens_encrypted', row.tokens_encrypted));
      throw error;
    }
  }

  async function authorizedRequest(path, options, userId, row, config, deadline) {
    let token = await access(userId, row, config, deadline);
    const send = () => {
      if (['POST', 'PATCH', 'DELETE'].includes(options.method) && !canWrite(userId, row, config)) {
        fail(403, 'permission_upgrade_required', 'Reconnect Google Calendar and grant event editing permission.');
      }
      return googleRequest(`https://www.googleapis.com/calendar/v3/${path}`, {
        ...options, headers: { ...options.headers, Authorization: ['Bearer', token].join(' ') },
      }, deadline, true);
    };
    try { return await send(); } catch (error) {
      if (error.code !== 'reconnect_required') throw error;
      token = await access(userId, row, config, deadline, true);
      try { return await send(); } catch (retryError) {
        if (retryError.code === 'reconnect_required') {
          storage(await database().from(CONNECTIONS).delete().eq('user_id', userId).eq('tokens_encrypted', row.tokens_encrypted));
        }
        throw retryError;
      }
    }
  }

  function canWrite(userId, row, config) {
    if (!row || !config) return false;
    try { return writeScopes(decrypt(row.tokens_encrypted, config.key, `tokens:${userId}`)); }
    catch { return false; }
  }

  async function paginated(path, parameters, userId, row, config, deadline, metadata = {}) {
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
      if (body.accessRole !== undefined) metadata.accessRole = body.accessRole;
      if (body.timeZone !== undefined) metadata.timeZone = body.timeZone;
      items.push(...(body.items || []));
      if (!body.nextPageToken) return items;
      if (body.nextPageToken === pageToken) fail(502, 'pagination_limit', 'Google Calendar pagination could not complete.');
      pageToken = body.nextPageToken;
    }
    fail(502, 'pagination_limit', 'Calendar response exceeds the supported page limit. No partial results were returned.');
  }

  async function calendars(userId, row, config, deadline) {
    const items = await paginated('users/me/calendarList', { showHidden: 'false', showDeleted: 'false',
      fields: 'nextPageToken,items(id,summary,primary,backgroundColor,timeZone,deleted,accessRole)' }, userId, row, config, deadline);
    return items.filter((item) => !item.deleted && typeof item.id === 'string').map((item) => ({
      id: item.id, name: item.summary || 'Calendar', primary: Boolean(item.primary),
      color: item.backgroundColor || null, timeZone: item.timeZone || null,
      accessRole: item.accessRole || null,
      canWrite: canWrite(userId, row, config) && writableRole(item.accessRole),
    }));
  }

  async function mutate(action, body, userId, row, config, deadline) {
    mutationIds(body, action !== 'create');
    if (!row) fail(409, 'not_connected', 'Connect Google Calendar first.');
    if (!canWrite(userId, row, config)) fail(403, 'permission_upgrade_required', 'Reconnect Google Calendar and grant event editing permission.');
    let payload;
    let requestMarker;
    let eventId = body.eventId;
    if (action === 'create') {
      if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
        fail(400, 'invalid_request_id', 'Supply a caller-generated UUID requestId and reuse it when retrying creation.');
      }
      payload = eventPayload(body.event);
      requestMarker = createHash('sha256').update(JSON.stringify([userId, body.calendarId, body.requestId.toLowerCase()])).digest('hex');
      eventId = `c${requestMarker}`;
    }
    const available = await calendars(userId, row, config, deadline);
    if (!canWrite(userId, row, config)) fail(403, 'permission_upgrade_required', 'Reconnect Google Calendar and grant event editing permission.');
    const calendar = available.find((item) => item.id === body.calendarId || (body.calendarId === 'primary' && item.primary));
    if (!calendar || !calendar.canWrite) fail(403, 'calendar_read_only', 'Choose a calendar where you have owner or writer access.');
    const base = `calendars/${encodeURIComponent(body.calendarId)}/events`;
    const path = `${base}/${encodeURIComponent(eventId)}`;
    const model = (event) => {
      const normalized = event?.id === eventId && normalizeEvent(event, body.calendarId, {
        canWrite: true, accessRole: calendar.accessRole, timeZone: calendar.timeZone,
      });
      if (!normalized) fail(502, 'google_unavailable', 'Google returned an incomplete event. Refresh your calendar.');
      return normalized;
    };
    if (action === 'create') {
      try {
        const created = await authorizedRequest(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: eventId, extendedProperties: { private: { retaliateRequest: requestMarker } } }),
        }, userId, row, config, deadline);
        return { event: model(created) };
      } catch (error) {
        if (error.code !== 'request_conflict') throw error;
        const existing = await authorizedRequest(path, { method: 'GET' }, userId, row, config, deadline);
        if (existing.id !== eventId || existing.extendedProperties?.private?.retaliateRequest !== requestMarker ||
          existing.status === 'cancelled') fail(409, 'request_conflict', 'This request ID is already used. Refresh your calendar before retrying.');
        return { event: model(existing) };
      }
    }
    const existing = await authorizedRequest(path, { method: 'GET' }, userId, row, config, deadline);
    if (existing.id !== eventId || !mutableEvent(existing)) {
      fail(409, 'event_not_editable', 'Only unlocked standard events you organize or may modify, and individual recurring instances, can be changed. Whole series cannot be changed.');
    }
    if (typeof existing.etag !== 'string' || !/^"[^"\u0000-\u001f\u007f]{1,250}"$/.test(existing.etag)) {
      fail(502, 'google_unavailable', 'Google returned no usable event version. Refresh your calendar.');
    }
    if (body.etag !== undefined && body.etag !== existing.etag) {
      fail(412, 'event_conflict', 'This event changed in Google Calendar. Refresh before trying again.');
    }
    const headers = { 'If-Match': existing.etag };
    if (action === 'delete') {
      await authorizedRequest(path, { method: 'DELETE', headers }, userId, row, config, deadline);
      return { deleted: true, calendarId: body.calendarId, eventId };
    }
    payload = eventPayload(body.event, existing);
    const updated = await authorizedRequest(path, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) }, userId, row, config, deadline);
    return { event: model(updated) };
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const action = req.query?.action || req.body?.action;
    let callbackReturn;
    let callbackStateHash;
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
        if (req.headers?.origin && env.APP_ORIGIN) {
          let origin;
          try { origin = new URL(env.APP_ORIGIN).origin; } catch { /* Local deletion remains available without Google configuration. */ }
          if (origin && req.headers.origin !== origin) fail(403, 'invalid_origin', 'Request origin is not allowed.');
        }
        // State locks serialize against OAuth finalization before reading or deleting its saved connection.
        storage(await database().from(STATES).delete().eq('user_id', userId));
        const row = await connection(userId);
        let revokeToken;
        try {
          if (row) {
            const tokens = decrypt(row.tokens_encrypted, encryptionKey(env.GOOGLE_CALENDAR_ENCRYPTION_KEY), `tokens:${userId}`);
            revokeToken = tokens.refresh_token || tokens.access_token;
          }
        } catch { /* Missing or rotated encryption configuration must not block local deletion. */ }
        storage(await database().from(CONNECTIONS).delete().eq('user_id', userId));
        await revoke(revokeToken);
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
        if (!binding || typeof binding.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding.verifier) ||
          typeof binding.browser_hash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding.browser_hash) ||
          !equal(binding.browser_hash, hash(nonce))) fail(400, 'invalid_state', 'Calendar authorization did not originate in this browser.');
        const returnPath = pending.return_path === '/settings' ? '/settings' : '/today';
        callbackReturn = `${config.origin}${returnPath}`;
        callbackStateHash = stateHash;
        const invalidCode = typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096;
        if (req.query?.error || invalidCode) {
          const consumed = storage(await database().rpc('today_v2_consume_google_state', { p_state_hash: stateHash }));
          const saved = Array.isArray(consumed) ? consumed[0] : consumed;
          if (!saved || saved.user_id !== pending.user_id || saved.verifier_encrypted !== pending.verifier_encrypted ||
            !Number.isFinite(Date.parse(saved.expires_at)) || Date.parse(saved.expires_at) <= now()) fail(400, 'invalid_state', 'Calendar authorization was already used or expired.');
          if (req.query?.error) return res.redirect(303, `${callbackReturn}?googleCalendar=${req.query.error === 'access_denied' ? 'denied' : 'error'}`);
          fail(400, 'invalid_callback', 'Google authorization code is missing.');
        }
        const previous = await connection(pending.user_id);
        let oldTokens = {};
        if (previous) {
          try { oldTokens = decrypt(previous.tokens_encrypted, config.key, `tokens:${pending.user_id}`); }
          catch { /* Fresh offline consent can repair credentials encrypted with a lost or rotated key. */ }
        }
        const previousIds = previous?.selected_calendar_ids;
        const selectedIds = Array.isArray(previousIds) && previousIds.length <= MAX_CALENDARS &&
          previousIds.every((id) => typeof id === 'string' && id && id.length <= 1024) &&
          new Set(previousIds).size === previousIds.length ? previousIds : [];
        const body = await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: config.redirect, code_verifier: binding.verifier }, config, deadline);
        try {
          const tokens = mergeTokens(body, oldTokens, true);
          const finalized = storage(await database().rpc('today_v2_finish_google_authorization', {
            p_state_hash: stateHash, p_tokens_encrypted: encrypt(tokens, config.key, `tokens:${pending.user_id}`),
            p_selected_calendar_ids: selectedIds,
          }));
          const saved = Array.isArray(finalized) ? finalized[0] : finalized;
          if (!saved || saved.user_id !== pending.user_id) fail(400, 'invalid_state', 'Calendar authorization was already used, expired, or disconnected.');
        } catch (error) {
          await revoke(body.refresh_token || body.access_token);
          throw error;
        }
        return res.redirect(303, `${config.origin}${returnPath}?googleCalendar=connected`);
      }
      if (action === 'status') {
        let row;
        try {
          row = await connection(userId);
          storage(await database().from(STATES).select('state_hash').limit(0));
          storage(await database().rpc('today_v2_consume_google_state', { p_state_hash: hash(randomBytes(32)) }));
          storage(await database().rpc('today_v2_finish_google_authorization', {
            p_state_hash: hash(randomBytes(32)), p_tokens_encrypted: 'schema-probe', p_selected_calendar_ids: [],
          }));
          return res.status(200).json({ configured: Boolean(config), schemaAvailable: true, connected: Boolean(row),
            canWrite: canWrite(userId, row, config), needsUpgrade: Boolean(row) && !canWrite(userId, row, config),
            selectedCalendarIds: row?.selected_calendar_ids || [], ...(configError ? { message: configError.message } : {}) });
        } catch {
          return res.status(200).json({ configured: Boolean(config), schemaAvailable: false, connected: Boolean(row),
            canWrite: canWrite(userId, row, config), needsUpgrade: Boolean(row) && !canWrite(userId, row, config),
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
      if (['create', 'update', 'delete'].includes(action)) {
        return res.status(200).json(await mutate(action, req.body, userId, row, config, deadline));
      }
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
        const saved = storage(await database().from(CONNECTIONS).update({
          selected_calendar_ids: ids, updated_at: new Date(now()).toISOString(),
        }).eq('user_id', userId).select('user_id').maybeSingle());
        if (!saved) fail(409, 'not_connected', 'Connect Google Calendar first.');
        return res.status(200).json({ selectedCalendarIds: ids });
      }
      const range = eventRange(req.query?.timeMin, req.query?.timeMax);
      if (!row) fail(409, 'not_connected', 'Connect Google Calendar first.');
      const selected = row.selected_calendar_ids || [];
      if (!Array.isArray(selected) || selected.length > MAX_CALENDARS || selected.some((id) => typeof id !== 'string' || !id || id.length > 1024) ||
        new Set(selected).size !== selected.length) fail(400, 'invalid_selection', 'Select up to 10 calendars again.');
      const events = [];
      const unavailableCalendars = [];
      let completed = 0;
      let firstFailure;
      for (const id of selected) {
        try {
          const metadata = {};
          const items = await paginated(`calendars/${encodeURIComponent(id)}/events`, { ...range, singleEvents: 'true', showDeleted: 'true',
            fields: 'nextPageToken,accessRole,timeZone,items(id,etag,recurringEventId,originalStartTime,start,end,summary,status,transparency,locked,eventType,recurrence,organizer(self),guestsCanModify)' },
          userId, row, config, deadline, metadata);
          events.push(...items.map((event) => normalizeEvent(event, id, { ...metadata, canWrite: canWrite(userId, row, config) })).filter(Boolean));
          completed += 1;
        } catch (error) {
          if (!(error instanceof CalendarError) || ['reconnect_required', 'storage_unavailable', 'not_connected'].includes(error.code)) throw error;
          firstFailure ||= error;
          unavailableCalendars.push({ calendarId: id, code: error.code });
        }
      }
      if (firstFailure && !completed) throw firstFailure;
      return res.status(200).json({ events: [...new Map(events.map((event) => [event.id, event])).values()],
        selectedCalendarIds: selected, partial: unavailableCalendars.length > 0, unavailableCalendars, ...range });
    } catch (error) {
      const safe = error instanceof CalendarError ? error : new CalendarError(500, 'internal_error', 'Google Calendar request could not be completed.');
      if (callbackReturn) {
        try { storage(await database().rpc('today_v2_consume_google_state', { p_state_hash: callbackStateHash })); }
        catch { /* An unavailable database must not expose OAuth errors or credentials in the browser. */ }
        return res.redirect(303, `${callbackReturn}?googleCalendar=error`);
      }
      return res.status(safe.status).json({ error: safe.message, code: safe.code });
    }
  };
}
