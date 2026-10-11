// @vitest-environment node
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Resend } from 'resend';
import {
  acceptsRecipients, buildStoredMessage, notificationPayload, processNotification,
  retrieveMessage, supportHandler, suppressNotification, validateEvent,
} from '../../server/supportInbox.js';

const id = '00000000-0000-4000-8000-000000000001';
const key = Buffer.from('test signing material only').toString('base64');
const event = () => ({
  type: 'email.received', created_at: new Date().toISOString(),
  data: { email_id: id, from: 'Sender <sender@example.test>', to: ['support@retaliateai.com'], subject: 'Help', message_id: '<test>' },
});
const email = () => ({ id, from: 'Sender <sender@example.test>', to: ['support@retaliateai.com'],
  subject: 'Help', message_id: '<test>', text: 'Please help', html: '<img src="https://evil.test">', attachments: [] });
const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });
function request(payload, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', Buffer.from(key, 'base64'))
    .update(`webhook-test.${timestamp}.${payload}`).digest('base64');
  const req = Readable.from([payload]);
  req.method = 'POST';
  req.headers = { 'svix-id': 'webhook-test', 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` };
  return req;
}
function builder(data = null, error = null) {
  const query = { then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject) };
  for (const method of ['select','eq','update','maybeSingle','single']) query[method] = vi.fn(() => query);
  return query;
}
beforeEach(() => {
  vi.stubEnv('SUPPORT_WEBHOOK_SECRET', `whsec_${key}`);
  vi.stubEnv('SUPPORT_NOTIFICATION_EMAIL', 'owner@example.test');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Retaliate <notify@retaliateai.com>');
  vi.stubEnv('PUBLIC_APP_ORIGIN', '');
  vi.stubEnv('SUPPORT_ACCEPT_CATCH_ALL', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('verified support intake', () => {
  it.each(['missing', 'invalid', 'expired'])('rejects %s signatures before any side effects', async (kind) => {
    const req = request(JSON.stringify(event()), kind === 'expired' ? 1 : undefined);
    if (kind === 'missing') req.headers = {};
    if (kind === 'invalid') req.headers['svix-signature'] = 'v1,bad';
    const db = { from: vi.fn(), rpc: vi.fn() };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const resend = new Resend('test-api-key');
    const send = vi.spyOn(resend.emails, 'send');
    const res = response();
    await supportHandler(req, res, { db, resend });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('verifies original whitespace and ignores unaccepted events without retrieval', async () => {
    const payload = JSON.stringify({ ...event(), type: 'email.sent' }, null, 2);
    const db = { from: vi.fn() }; const res = response();
    await supportHandler(request(payload), res, { db, resend: new Resend('test-api-key') });
    expect(res.json).toHaveBeenCalledWith({ ignored: true });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('bounds raw request size', async () => {
    const res = response();
    await supportHandler(request('x'.repeat(128 * 1024 + 1)), res, { db: {}, resend: {} });
    expect(res.status).toHaveBeenCalledWith(413);
  });
  it('rejects slow request bodies with a deadline', async () => {
    vi.useFakeTimers();
    try {
      const req = new Readable({ read() {} }); req.method = 'POST'; req.headers = {};
      const res = response();
      const result = supportHandler(req, res, { db: {}, resend: {} });
      await vi.advanceTimersByTimeAsync(5001);
      await result;
      expect(res.status).toHaveBeenCalledWith(408);
    } finally { vi.useRealTimers(); }
  });
  it('filters support, case, multiple envelope recipients and domain-only catch-all', () => {
    expect(acceptsRecipients({ to: ['OTHER@example.test','SUPPORT@RetaliateAI.com'] })).toBe(true);
    expect(acceptsRecipients({ to: ['support@retaliateai.com'], received_for: ['other@example.test'] })).toBe(false);
    vi.stubEnv('SUPPORT_ACCEPT_CATCH_ALL','true');
    expect(acceptsRecipients({ to: [], received_for: ['billing@retaliateai.com'] })).toBe(true);
    expect(acceptsRecipients({ to: ['support@evil.test'] })).toBe(false);
    expect(() => validateEvent({ ...event(), data: { ...event().data, email_id: '../escape' } })).toThrow();
  });
  it('retrieves only from fixed authenticated API and strips attachment URLs', async () => {
    const full = { ...email(), attachments: [{ id: 'a', filename: 'file.txt', content_type: 'text/plain', download_url: 'http://localhost' }] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(full)));
    vi.stubGlobal('fetch', fetch);
    const retrieved = await retrieveMessage(id);
    expect(fetch.mock.calls[0][0]).toBe(`https://api.resend.com/emails/receiving/${id}?html_format=cid`);
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    expect(buildStoredMessage(event(), retrieved).attachments[0]).not.toHaveProperty('download_url');
  });
  it('rejects missing/oversized bodies and stores inert HTML and empty valid bodies', () => {
    expect(() => buildStoredMessage(event(), { ...email(), text: null, html: null })).toThrow(/no message body/);
    expect(() => buildStoredMessage(event(), { ...email(), text: 'x'.repeat(2 * 1024 * 1024), html: 'extra' })).toThrow();
    expect(buildStoredMessage(event(), { ...email(), text: '', html: null }).text_body).toBe('');
    expect(buildStoredMessage(event(), email()).html_body).toContain('<img');
  });
  it('stores before notifying, even with missing owner setup', async () => {
    vi.stubEnv('SUPPORT_NOTIFICATION_EMAIL','');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(email()))));
    const operations = [];
    const db = {
      from: vi.fn(() => builder()),
      rpc: vi.fn(async (name, args) => {
        operations.push(name);
        if (name === 'support_store_message') {
          expect(args.p_payload).toBeNull();
          expect(args.p_message.text_body).toBe('Please help');
        }
        return { data: [], error: null };
      }),
    };
    const res = response();
    await supportHandler(request(JSON.stringify(event())), res, { db, resend: new Resend('test-api-key') });
    expect(operations).toEqual(['support_store_message','support_claim_notification']);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('does not retrieve or recreate already accepted or deleted messages on replay', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const db = { from: vi.fn(() => builder({ status: 'suppressed' })), rpc: vi.fn().mockResolvedValue({ data: [] }) };
    await supportHandler(request(JSON.stringify(event())), response(), { db, resend: new Resend('test-api-key') });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('notification delivery', () => {
  const job = () => ({ provider_email_id: id, message_id: id, lease_token: 'lease', payload: { to: 'owner@example.test', subject: 'Help' } });
  it('escapes content, strips subject controls, links canonical message and disallows inbound destination', () => {
    const message = buildStoredMessage(event(), { ...email(), subject: '<script>\r\nInjected', text: '<b>preview</b>' });
    const payload = notificationPayload(message);
    expect(payload.subject).not.toMatch(/[\r\n]/);
    expect(payload.html).toContain('&lt;script&gt;');
    expect(payload.html).toContain(`https://retaliateai.com/admin/support-inbox/${message.id}`);
    vi.stubEnv('SUPPORT_NOTIFICATION_EMAIL','support@retaliateai.com');
    expect(() => notificationPayload(message)).toThrow();
    expect(suppressNotification({ ...message, subject: '[Retaliate support] loop' }, email())).toBeTruthy();
    expect(suppressNotification(message, { headers: { 'Auto-Submitted': 'auto-generated' } })).toBeTruthy();
  });
  it('uses a durable claim and stable outbound idempotency key', async () => {
    const query = builder([{ message_id: id }]);
    const db = { rpc: vi.fn().mockResolvedValue({ data: [job()] }), from: vi.fn(() => query) };
    const resend = { emails: { send: vi.fn().mockResolvedValue({ data: { id: 'sent' } }) } };
    expect(await processNotification(db,resend,id)).toBe(true);
    expect(resend.emails.send).toHaveBeenCalledWith(job().payload, expect.objectContaining({ idempotencyKey: `support-notification/${id}`, signal: expect.any(AbortSignal) }));
    expect(query.eq).toHaveBeenCalledWith('lease_token','lease');
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });
  it.each(['provider','acknowledgement'])('retains failed status and reuses identical payload/key after %s failure', async (failure) => {
    const updates = [];
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: [job()] }),
      from: vi.fn().mockImplementationOnce(() => {
        const query = builder(null, failure === 'acknowledgement' ? { message: 'db down' } : null);
        query.update = vi.fn((value) => { updates.push(value); return query; }); return query;
      }).mockImplementation(() => {
        const query = builder([{ message_id: id }]);
        query.update = vi.fn((value) => { updates.push(value); return query; }); return query;
      }),
    };
    const resend = { emails: { send: vi.fn().mockResolvedValue(failure === 'provider' ? { error: {} } : { data: { id: 'sent' } }) } };
    await expect(processNotification(db,resend,id)).rejects.toThrow(/needs retry/);
    expect(updates.at(-1).status).toBe('failed');
    resend.emails.send.mockResolvedValue({ data: { id: 'sent' } });
    await processNotification(db,resend,id);
    expect(resend.emails.send.mock.calls[0]).toEqual(resend.emails.send.mock.calls[1].map((value, index) => index === 1 ? expect.objectContaining({ idempotencyKey: `support-notification/${id}` }) : value));
  });
  it('never sends without a claim, including concurrent delivery or expired safety window', async () => {
    const resend = { emails: { send: vi.fn() } };
    expect(await processNotification({ rpc: vi.fn().mockResolvedValue({ data: [] }) }, resend)).toBe(false);
    expect(resend.emails.send).not.toHaveBeenCalled();
  });
  it('protects bounded recovery with CRON_SECRET, not browser authentication', async () => {
    const db = { rpc: vi.fn() }; const res = response();
    await supportHandler({ method: 'GET', headers: {} }, res, { db, resend: {} });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
