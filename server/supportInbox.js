import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { escapeHtml, isAuthorizedCron, publicAppUrl } from './notifications.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 2 * 1024 * 1024;
const WEBHOOK_LIMIT = 128 * 1024;
const TIMEOUT = 5000;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const boundedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT) });

export function supportClients() {
  return {
    db: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: boundedFetch },
    }),
    resend: new Resend(process.env.RESEND_API_KEY),
  };
}

async function readBounded(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw httpError(413, 'Message exceeds intake limit');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readWebhook(req) {
  let timer;
  try {
    return await Promise.race([
      readBounded(req, WEBHOOK_LIMIT),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(httpError(408, 'Webhook body timed out'));
          req.destroy?.();
        }, TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function string(value, max, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || value.length > max) throw httpError(400, 'Invalid message metadata');
  return value;
}

function addresses(value, optional = false) {
  if (optional && value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw httpError(400, 'Invalid recipients');
  return value.map((address) => string(address, 320));
}

function mailbox(value) {
  const match = value.trim().match(/^(?:[^<>\r\n]*<)?([^<>\s@,;:]+@[^<>\s@,;:]+)>?$/);
  return match?.[1].toLowerCase() || '';
}

export function acceptsRecipients(data) {
  // received_for is the envelope destination, including BCC when available.
  const recipients = data.received_for?.length
    ? addresses(data.received_for)
    : [...addresses(data.to), ...addresses(data.cc, true), ...addresses(data.bcc, true)];
  return recipients.some((value) => {
    const address = mailbox(value);
    return process.env.SUPPORT_ACCEPT_CATCH_ALL === 'true'
      ? /^[^@]+@retaliateai\.com$/.test(address)
      : address === 'support@retaliateai.com';
  });
}

export function validateEvent(event) {
  if (event?.type !== 'email.received') return false;
  const data = event.data;
  if (!data || !UUID.test(data.email_id || '')) throw httpError(400, 'Invalid provider email ID');
  string(data.from, 1000);
  string(data.subject, 2000);
  string(data.message_id, 1000, true);
  addresses(data.to);
  addresses(data.cc, true);
  addresses(data.bcc, true);
  addresses(data.received_for, true);
  const received = data.created_at || event.created_at;
  if (typeof received !== 'string' || !Number.isFinite(Date.parse(received))) {
    throw httpError(400, 'Invalid received timestamp');
  }
  return acceptsRecipients(data);
}

export async function retrieveMessage(providerId) {
  // Fixed authenticated API only. Never fetch raw/attachment URLs from email content.
  const response = await boundedFetch(`https://api.resend.com/emails/receiving/${providerId}?html_format=cid`, {
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
    redirect: 'error',
  });
  if (!response.ok) throw httpError(503, 'Unable to retrieve received email');
  const body = await readBounded(response.body, 3 * MAX_BODY);
  try { return JSON.parse(body); } catch { throw httpError(503, 'Invalid receiving API response'); }
}

export function buildStoredMessage(event, email) {
  if (email.id !== event.data.email_id) throw httpError(503, 'Receiving email ID mismatch');
  const text = string(email.text, MAX_BODY, true);
  const html = string(email.html, MAX_BODY, true);
  if (text === null && html === null) throw httpError(503, 'Receiving API returned no message body');
  if (Buffer.byteLength(text || '') + Buffer.byteLength(html || '') > MAX_BODY) {
    throw httpError(413, 'Email body exceeds 2 MiB limit');
  }
  const attachments = email.attachments || [];
  if (!Array.isArray(attachments) || attachments.length > 100) throw httpError(413, 'Too many attachments');
  return {
    id: randomUUID(),
    provider_email_id: event.data.email_id,
    sender: string(email.from, 1000),
    recipients: [...new Set([
      ...addresses(email.to), ...addresses(email.cc, true), ...addresses(email.bcc, true),
      ...addresses(event.data.received_for, true),
    ])],
    cc: addresses(email.cc, true),
    subject: string(email.subject, 2000),
    message_id: string(email.message_id, 1000, true),
    received_at: new Date(event.data.created_at || event.created_at).toISOString(),
    text_body: text,
    html_body: html,
    attachments: attachments.map((attachment) => ({
      id: string(attachment.id, 100),
      filename: string(attachment.filename, 1000, true),
      content_type: string(attachment.content_type, 200),
      content_id: string(attachment.content_id, 1000, true),
      disposition: string(attachment.content_disposition, 100, true),
      size: Number.isSafeInteger(attachment.size) && attachment.size >= 0 ? attachment.size : null,
    })),
  };
}

export function notificationPayload(message) {
  const to = process.env.SUPPORT_NOTIFICATION_EMAIL?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!to || !from || !mailbox(to) || !mailbox(from)
    || /[\r\n]/.test(to + from) || mailbox(to).endsWith('@retaliateai.com')) {
    throw httpError(503, 'Configure a personal notification destination and verified sender');
  }
  const subject = `[Retaliate support] ${message.subject.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 180)}`;
  const link = publicAppUrl(`/admin/support-inbox/${message.id}`);
  const preview = (message.text_body || '').slice(0, 300);
  return {
    from, to, subject,
    text: `From: ${message.sender}\nTo: ${message.recipients.join(', ')}\nSubject: ${message.subject}\n\n${preview}\n\n${link}`,
    html: `<p>From: ${escapeHtml(message.sender)}</p><p>To: ${escapeHtml(message.recipients.join(', '))}</p><p>Subject: ${escapeHtml(message.subject)}</p><p>${escapeHtml(preview)}</p><p><a href="${escapeHtml(link)}">View support message</a></p>`,
    headers: { 'X-Retaliate-Support-Notification': '1', 'Auto-Submitted': 'auto-generated' },
  };
}

export function suppressNotification(message, email) {
  const headers = Object.fromEntries(Object.entries(email.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  return mailbox(message.sender) === mailbox(process.env.RESEND_FROM_EMAIL || '')
    || headers['x-retaliate-support-notification'] === '1'
    || (headers['auto-submitted'] && headers['auto-submitted'] !== 'no')
    || message.subject.startsWith('[Retaliate support]');
}

export async function processNotification(db, resend, providerId = null) {
  const { data: jobs, error } = await db.rpc('support_claim_notification', { p_provider: providerId });
  if (error) throw httpError(503, 'Unable to claim notification');
  const job = jobs?.[0];
  if (!job) return false;
  try {
    let payload = job.payload;
    if (!payload) {
      const { data: message, error: messageError } = await db.from('support_messages')
        .select('*').eq('id', job.message_id).single();
      if (messageError || !message) throw new Error('Stored message unavailable');
      payload = notificationPayload(message);
      const { data, error: payloadError } = await db.from('support_notification_jobs')
        .update({ payload }).eq('provider_email_id', job.provider_email_id)
        .eq('lease_token', job.lease_token).select('message_id');
      if (payloadError || !data?.length) throw new Error('Unable to freeze notification payload');
    }
    const result = await resend.emails.send(payload, {
      idempotencyKey: `support-notification/${job.provider_email_id}`,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (result.error || !result.data?.id) throw new Error('Notification provider failed');
    const { data, error: updateError } = await db.from('support_notification_jobs')
      .update({ status: 'sent', outbound_email_id: result.data.id, lease_until: null, lease_token: null, last_error: null })
      .eq('provider_email_id', job.provider_email_id).eq('lease_token', job.lease_token).select('message_id');
    if (updateError || !data?.length) throw new Error('Notification delivery acknowledgement failed');
    return true;
  } catch {
    const { error: updateError } = await db.from('support_notification_jobs')
      .update({
        status: 'failed', lease_until: null, lease_token: null,
        next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        last_error: 'Delivery or acknowledgement failed; retry uses the same provider idempotency key',
      }).eq('provider_email_id', job.provider_email_id).eq('lease_token', job.lease_token);
    if (updateError) console.error('support-inbox: notification state update failed');
    throw httpError(503, 'Message stored; notification needs retry');
  }
}

export async function recoverNotifications(db, resend, limit = 1) {
  let processed = 0;
  for (let index = 0; index < limit; index++) {
    if (!await processNotification(db, resend)) break;
    processed++;
  }
  return processed;
}

export async function supportHandler(req, res, clients) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { db, resend } = clients || supportClients();
      return res.status(200).json({ processed: await recoverNotifications(db, resend) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!process.env.SUPPORT_WEBHOOK_SECRET) throw httpError(503, 'Webhook signing is not configured');
    const raw = await readWebhook(req);
    let event;
    try {
      const verifier = clients?.resend || new Resend(process.env.RESEND_API_KEY || 'verification-only');
      event = verifier.webhooks.verify({
        payload: raw,
        headers: {
          id: req.headers['svix-id'],
          timestamp: req.headers['svix-timestamp'],
          signature: req.headers['svix-signature'],
        },
        webhookSecret: process.env.SUPPORT_WEBHOOK_SECRET,
      });
    } catch { throw httpError(401, 'Invalid webhook signature'); }
    if (!validateEvent(event)) return res.status(200).json({ ignored: true });
    const { db, resend } = clients || supportClients();
    const providerId = event.data.email_id;
    const { data: existing, error } = await db.from('support_notification_jobs')
      .select('status').eq('provider_email_id', providerId).maybeSingle();
    if (error) throw httpError(503, 'Unable to check message delivery');
    if (!existing) {
      const email = await retrieveMessage(providerId);
      const message = buildStoredMessage(event, email);
      let payload = null;
      try { payload = notificationPayload(message); } catch { /* Store even when owner setup is incomplete. */ }
      const { error: storeError } = await db.rpc('support_store_message', {
        p_message: message, p_payload: payload, p_suppressed: Boolean(suppressNotification(message, email)),
      });
      if (storeError) throw httpError(503, 'Unable to store message');
    }
    await processNotification(db, resend, providerId);
    return res.status(200).json({ stored: true });
  } catch (error) {
    console.error('support-inbox:', error.status || 503);
    return res.status(error.status || 503).json({ error: error.status ? error.message : 'Support intake temporarily unavailable' });
  }
}
