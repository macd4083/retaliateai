// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserById: vi.fn(),
  sendEmail: vi.fn(),
  sendPush: vi.fn(),
  constructEvent: vi.fn(),
  checkout: vi.fn(),
  authenticatedUser: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mocks.from, auth: { admin: { getUserById: mocks.getUserById } } }),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.sendEmail }; } }));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mocks.sendPush },
}));
vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: mocks.constructEvent };
    checkout = { sessions: { create: mocks.checkout } };
  },
}));
vi.mock('../lib/auth.js', () => ({ getAuthenticatedUserId: mocks.authenticatedUser }));

import missedHandler from '../../api/missed-sessions-email.js';
import trialHandler from '../../api/trial-reminder-email.js';
import pushHandler from '../../api/push.js';
import stripeHandler from '../../api/stripe.js';
import webhookHandler from '../../api/stripe-webhook.js';
import {
  escapeHtml,
  getLocalReviewContext,
  getServerDayBoundaryHour,
  publicAppUrl,
} from '../../server/notifications.js';

const queryLog = [];
function queueQuery(data, error = null) {
  mocks.from.mockImplementationOnce((table) => {
    const record = { table, operations: [] };
    queryLog.push(record);
    const builder = {
      then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject),
    };
    for (const name of ['select', 'eq', 'in', 'not', 'lt', 'limit', 'order', 'update', 'delete', 'maybeSingle']) {
      builder[name] = (...args) => {
        record.operations.push([name, ...args]);
        return builder;
      };
    }
    return builder;
  });
}
function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() };
}
function request(extra = {}) {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer ' + 'notification-test-secret' },
    ...extra,
  };
}
function missedProfile(overrides = {}) {
  return { id: 'user-1', timezone: 'America/Los_Angeles', ...overrides };
}
function queueMissedEligibility() {
  queueQuery([missedProfile()]);
  queueQuery({ local_date: '2026-09-30', completed_at: '2026-09-30T20:00:00Z', timezone_name: 'America/Los_Angeles' });
  queueQuery([]);
  queueQuery([{ local_date: '2026-09-30', completed_at: '2026-09-30T20:00:00Z' }]);
  queueQuery(null);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T10:30:00Z')); // 03:30 PDT: review day Oct 5.
  vi.stubEnv('CRON_SECRET', 'notification-test-secret');
  vi.stubEnv('PUBLIC_APP_ORIGIN', '');
  vi.stubEnv('VITE_TODAY_V2_DAY_BOUNDARY_HOUR', '');
  queryLog.length = 0;
  mocks.getUserById.mockResolvedValue({ data: { user: { email: 'reader@example.test' } } });
  mocks.sendEmail.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  mocks.sendPush.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('notification configuration and review calendar', () => {
  it('uses the verified production origin or the one explicit override', () => {
    expect(publicAppUrl('/today')).toBe('https://retaliateai.com/today');
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://preview.example.test');
    expect(publicAppUrl('/settings?checkout=success')).toBe('https://preview.example.test/settings?checkout=success');
  });
  it.each(['javascript:alert(1)', 'https://example.test/subpath', '******example.test'])(
    'rejects invalid configured origins: %s', (origin) => {
      vi.stubEnv('PUBLIC_APP_ORIGIN', origin);
      expect(() => publicAppUrl('/app')).toThrow();
    }
  );
  it('escapes HTML including link attribute characters', () => {
    expect(escapeHtml('<a "x" & \'y\'>')).toBe('&lt;a &quot;x&quot; &amp; &#39;y&#39;&gt;');
  });
  it('defaults to the same 4 AM boundary as V2 and honors deployment override', () => {
    expect(getServerDayBoundaryHour()).toBe(4);
    vi.stubEnv('VITE_TODAY_V2_DAY_BOUNDARY_HOUR', '3');
    expect(getServerDayBoundaryHour()).toBe(3);
    expect(getLocalReviewContext(new Date(), 'America/Los_Angeles').reviewDate).toBe('2026-10-06');
  });
  it('uses completed local review days, not UTC calendar dates', () => {
    expect(getLocalReviewContext(new Date(), 'America/Los_Angeles')).toEqual({
      reviewDate: '2026-10-05', missedDates: ['2026-10-04', '2026-10-03'], hour: 3, minute: 30,
    });
    expect(getLocalReviewContext(new Date('2026-10-06T11:00:00Z'), 'America/Los_Angeles').reviewDate).toBe('2026-10-06');
    expect(getLocalReviewContext(new Date('2026-01-01T00:30:00Z'), 'Pacific/Kiritimati').missedDates)
      .toEqual(['2025-12-31', '2025-12-30']);
  });
  it.each(['2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z'])('preserves the review date over DST: %s', (now) => {
    expect(getLocalReviewContext(new Date(now), 'America/Los_Angeles').reviewDate).toBe('2026-03-07');
  });
  it.each([null, '', 'unknown/timezone'])('skips unknown timezones: %s', (timezone) => {
    expect(getLocalReviewContext(new Date(), timezone)).toBeNull();
  });
});

describe('cron delivery authorization', () => {
  it.each([missedHandler, trialHandler, pushHandler])('rejects unauthenticated requests before querying', async (handler) => {
    const res = response();
    await handler(request({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });
  it.each([missedHandler, trialHandler, pushHandler])('fails closed without the deployment secret', async (handler) => {
    vi.stubEnv('CRON_SECRET', '');
    const res = response();
    await handler(request(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not accept a secret through URL query or a wrong bearer', async () => {
    const res = response();
    await missedHandler(request({ headers: { authorization: '******' }, query: { secret: 'notification-test-secret' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('V2 missed-review email', () => {
  it('sends neutral copy after two missed review days and a prior V2 completion', async () => {
    queueMissedEligibility();
    const res = response();
    await missedHandler(request({ headers: { ...request().headers, host: 'untrusted.example' } }), res);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Review today and prepare tomorrow',
      html: expect.stringContaining('https://retaliateai.com/today'),
    }));
    expect(queryLog.map(({ table }) => table)).toEqual([
      'user_profiles', 'today_v2_daily_reviews', 'today_v2_daily_reviews', 'today_v2_daily_reviews', 'user_profiles',
    ]);
    expect(queryLog[1].operations).toContainEqual(['order', 'completed_at', { ascending: false }]);
    expect(queryLog[1].operations).toContainEqual(['not', 'completed_at', 'is', null]);
    expect(queryLog[2].operations).toContainEqual(['in', 'local_date', ['2026-10-04', '2026-10-03', '2026-10-05']]);
    expect(queryLog[2].operations).toContainEqual(['not', 'completed_at', 'is', null]);
    expect(queryLog[3].operations).toContainEqual(['lt', 'local_date', '2026-10-03']);
    expect(queryLog[3].operations).toContainEqual(['not', 'completed_at', 'is', null]);
    expect(queryLog[4].operations).toContainEqual(['update', { last_reengagement_email_sent: '2026-10-06T10:30:00.000Z' }]);
    expect(mocks.sendEmail.mock.calls[0][0].html).not.toMatch(/streak|excuses|untrusted/);
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain('Review &amp; Plan');
    expect(res.json).toHaveBeenCalledWith({ sent: 1, users: ['user-1'] });
  });
  it.each([
    { data: [{ local_date: '2026-10-04', completed_at: '2026-10-04T23:00:00Z' }], error: null },
    { data: null, error: { message: 'database unavailable' } },
  ])('sends no email for recent completion or a failed recent query', async ({ data, error }) => {
    queueQuery([missedProfile()]);
    queueQuery({ timezone_name: 'America/Los_Angeles' });
    queueQuery(data, error);
    await missedHandler(request(), response());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
  it.each([
    { data: [], error: null },
    { data: null, error: { message: 'database unavailable' } },
  ])('requires a successful prior-completion lookup', async ({ data, error }) => {
    queueQuery([missedProfile()]);
    queueQuery({ timezone_name: 'America/Los_Angeles' });
    queueQuery([]);
    queueQuery(data, error);
    await missedHandler(request(), response());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it('does not email users without a trustworthy timezone or within seven days', async () => {
    queueQuery([missedProfile(), missedProfile(), missedProfile({ last_reengagement_email_sent: '2026-09-30T10:30:00Z' })]);
    queueQuery({ timezone_name: null });
    queueQuery({ timezone_name: 'invalid' });
    await missedHandler(request(), response());
    expect(queryLog).toHaveLength(3);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it('permits sending exactly seven days after the previous email', async () => {
    queueQuery([missedProfile({ last_reengagement_email_sent: '2026-09-29T10:30:00Z' })]);
    queueQuery({ timezone_name: 'America/Los_Angeles' });
    queueQuery([]);
    queueQuery([{ completed_at: '2026-09-28T23:00:00Z' }]);
    queueQuery(null);
    await missedHandler(request(), response());
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });
  it('does not update the cooldown when delivery fails', async () => {
    queueMissedEligibility();
    mocks.sendEmail.mockResolvedValue({ error: { message: 'delivery failed' } });
    await missedHandler(request(), response());
    expect(queryLog).toHaveLength(4);
  });
  it('fails without sending on a profile query error', async () => {
    queueQuery(null, { message: 'database unavailable' });
    const res = response();
    await missedHandler(request(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it('uses the last completed V2 review timezone rather than a stale profile default', async () => {
    queueQuery([missedProfile({ timezone: 'America/New_York' })]);
    queueQuery({ timezone_name: 'America/Los_Angeles', completed_at: '2026-09-30T20:00:00Z' });
    queueQuery([]);
    queueQuery([{ local_date: '2026-09-30', completed_at: '2026-09-30T20:00:00Z' }]);
    queueQuery(null);
    await missedHandler(request(), response());
    expect(queryLog[2].operations).toContainEqual(['in', 'local_date', ['2026-10-04', '2026-10-03', '2026-10-05']]);
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });
  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'database unavailable' } },
  ])('requires a trustworthy completed V2 review timezone lookup', async ({ data, error }) => {
    queueQuery([missedProfile()]);
    queueQuery(data, error);
    await missedHandler(request(), response());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(queryLog).toHaveLength(2);
  });
});

describe('trial email routing and rules', () => {
  it.each([
    { end: '2026-10-07T10:30:00Z', feedback: false, extended: false, type: 'ending_soon', target: '/app' },
    { end: '2026-10-05T10:30:00Z', feedback: false, extended: false, type: 'trial_expired_feedback_offer', target: '/app' },
    { end: '2026-10-05T10:30:00Z', feedback: true, extended: true, type: 'extended_trial_expired', target: '/settings' },
  ])('preserves $type rules and destination', async ({ end, feedback, extended, type, target }) => {
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://staging.example.test');
    queueQuery([{ id: 'user-1', trial_ends_at: end, feedback_submitted: feedback, trial_extended: extended }]);
    queueQuery(null);
    const res = response();
    await trialHandler(request(), res);
    const email = mocks.sendEmail.mock.calls[0][0];
    expect(email.html).toContain(`https://staging.example.test${target}`);
    expect(email.html).not.toMatch(/\/reflection|excuses|tonight/);
    if (type === 'ending_soon') expect(email.html).toContain('https://staging.example.test/settings');
    expect(res.json).toHaveBeenCalledWith({ sent: 1, emails: [{ user_id: 'user-1', type }] });
  });
  it('preserves the two-day cooldown and does not send before the reminder window', async () => {
    queueQuery([
      { id: 'user-1', trial_ends_at: '2026-10-07T10:30:00Z', last_trial_email_sent_at: '2026-10-05T10:30:00Z' },
      { id: 'user-2', trial_ends_at: '2026-10-09T10:30:00Z' },
    ]);
    await trialHandler(request(), response());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe('push producers', () => {
  it('normalizes direct sends to neutral Today reminders even for legacy payloads', async () => {
    queueQuery([{ subscription: { endpoint: 'https://push.example.test' } }]);
    await pushHandler(request({ method: 'POST', body: {
      user_id: 'user-1', title: 'Private commitment', body: 'Do not break your streak', url: '/reflection',
    } }), response());
    expect(JSON.parse(mocks.sendPush.mock.calls[0][1])).toEqual({
      title: 'Retaliate AI', body: 'Review today and prepare tomorrow.', url: '/today',
    });
  });
  it('schedules in profile timezone and checks only the current V2 review', async () => {
    queueQuery([{ ...missedProfile(), preferred_reflection_time: '03:30:00' }]);
    queueQuery(null);
    queueQuery([{ subscription: { endpoint: 'https://push.example.test' } }]);
    await pushHandler(request(), response());
    expect(queryLog[1].table).toBe('today_v2_daily_reviews');
    expect(queryLog[1].operations).toContainEqual(['eq', 'local_date', '2026-10-05']);
    expect(mocks.sendPush).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.sendPush.mock.calls[0][1]).body).toBe('Review today and prepare tomorrow.');
    expect(queryLog.some(({ table }) => table === 'reflection_sessions')).toBe(false);
  });
  it.each([
    { data: { completed_at: '2026-10-06T09:00:00Z' }, error: null },
    { data: null, error: { message: 'database unavailable' } },
  ])('suppresses pushes after completion or review lookup failure', async ({ data, error }) => {
    queueQuery([{ ...missedProfile(), preferred_reflection_time: '03:30:00' }]);
    queueQuery(data, error);
    await pushHandler(request(), response());
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });
});

describe('Stripe outbound URLs and email copy', () => {
  it('keeps checkout success and cancellation in canonical Settings', async () => {
    mocks.authenticatedUser.mockResolvedValue('user-1');
    mocks.checkout.mockResolvedValue({ url: 'https://checkout.stripe.com/session' });
    queueQuery({ stripe_customer_id: 'customer-1' });
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://billing.example.test');
    await stripeHandler(request({ method: 'POST', body: { action: 'checkout', user_id: 'user-1', email: 'reader@example.test' } }), response());
    expect(mocks.checkout).toHaveBeenCalledWith(expect.objectContaining({
      success_url: 'https://billing.example.test/settings?checkout=success',
      cancel_url: 'https://billing.example.test/settings',
    }));
  });
  it('uses new-product copy and /app after a signed checkout webhook', async () => {
    mocks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed', data: { object: { customer: 'customer-1', subscription: 'subscription-1' } },
    });
    queueQuery(null);
    queueQuery({ id: 'user-1' });
    const req = request({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); } });
    await webhookHandler(req, response());
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain('https://retaliateai.com/app');
    expect(mocks.sendEmail.mock.calls[0][0].html).not.toMatch(/nightly|excuses|\/reflection/);
  });
});

describe('installed service worker notification routing', () => {
  function loadWorker() {
    const listeners = {};
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const clients = { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn().mockResolvedValue(undefined) };
    const context = {
      URL,
      self: {
        location: { origin: 'https://retaliateai.com' },
        registration: { showNotification },
        addEventListener: (event, listener) => { listeners[event] = listener; },
      },
      clients,
    };
    vm.runInNewContext(readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8'), context);
    return { listeners, showNotification, clients };
  }
  it.each([undefined, '', '   ', '/reflection', ' /reflection ', '/Reflection?legacy=1', 'https://evil.example/steal', '//evil.example', 'https://retaliateai.com//evil.example', 'javascript:alert(1)'])(
    'normalizes missing, unsafe, or legacy payload URLs: %s', async (url) => {
      const { listeners, showNotification } = loadWorker();
      let promise;
      listeners.push({ data: { json: () => ({ url }) }, waitUntil: (value) => { promise = value; } });
      await promise;
      expect(showNotification.mock.calls[0][1].data.url).toBe('/today');
      expect(showNotification.mock.calls[0][1].body).toBe('Review today and prepare tomorrow.');
    }
  );
  it('focuses an existing same-origin window before navigating and does not open duplicates', async () => {
    const { listeners, clients } = loadWorker();
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    clients.matchAll.mockResolvedValue([
      { url: 'https://evil.example/?https://retaliateai.com', focus: vi.fn() },
      { url: 'https://retaliateai.com/settings', focus, navigate },
    ]);
    let promise;
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: '/reflection' } },
      waitUntil: (value) => { promise = value; },
    });
    await promise;
    expect(focus).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/today');
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });
  it('opens Today when no same-origin client exists', async () => {
    const { listeners, clients } = loadWorker();
    let promise;
    listeners.notificationclick({ notification: { close: vi.fn() }, waitUntil: (value) => { promise = value; } });
    await promise;
    expect(clients.openWindow).toHaveBeenCalledWith('/today');
  });
  it('handles malformed push payloads safely', async () => {
    const { listeners, showNotification } = loadWorker();
    let promise;
    listeners.push({ data: { json: () => { throw new Error('bad payload'); } }, waitUntil: (value) => { promise = value; } });
    await promise;
    expect(showNotification).toHaveBeenCalledOnce();
  });
  it('replaces stale reflection payload copy instead of surfacing commitments or streaks', async () => {
    const { listeners, showNotification } = loadWorker();
    let promise;
    listeners.push({
      data: { json: () => ({ url: '/reflection', title: 'Your private commitment', body: 'Do not break your streak' }) },
      waitUntil: (value) => { promise = value; },
    });
    await promise;
    expect(showNotification.mock.calls[0][0]).toBe('Retaliate AI');
    expect(showNotification.mock.calls[0][1].body).toBe('Review today and prepare tomorrow.');
  });
});

describe('push cron SQL deployment contract', () => {
  it('updates only the named job, keeps its payload neutral, and uses Vault authorization', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/add_nightly_push_cron.sql', import.meta.url), 'utf8');
    expect(sql).toContain("SELECT cron.schedule(");
    expect(sql).toContain("'nightly-push-notifications'");
    expect(sql).toContain('SELECT net.http_post(');
    expect(sql).toContain("'Authorization', 'Bearer ' || secret.decrypted_secret");
    expect(sql).toContain("origin.name = 'public_app_origin'");
    expect(sql).toContain("secret.name = 'cron_secret'");
    expect(sql).toContain("body := '{}'::jsonb");
    expect(sql).not.toMatch(/cron\.unschedule|drop table|delete from|reflection_sessions|commitment/i);
  });
  it('preserves the installed worker URL and includes handlers in the generated worker', () => {
    const worker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(worker).toContain("importScripts('/push-sw.js')");
    expect(config).toContain("importScripts: ['/push-sw.js']");
    expect(worker).not.toMatch(/skipWaiting|clients\.claim|reload/);
  });
});
