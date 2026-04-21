import crypto from 'crypto';

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function hashValue(value) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function splitDisplayName(displayName) {
  const cleaned = String(displayName || '').trim();
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function getClientIpAddress(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) return realIp;
  return req.socket?.remoteAddress || '';
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_e) {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = parseBody(req);
    const {
      eventName,
      eventId,
      eventSourceUrl,
      eventTime,
      user = {},
      fbc,
      fbp,
      subscriptionId,
      subscription_id,
    } = body;

    if (!eventName || !eventId) {
      return res.status(200).json({ ok: false, skipped: true, reason: 'Missing eventName or eventId' });
    }

    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!pixelId || !accessToken) {
      return res.status(200).json({ ok: false, skipped: true, reason: 'Meta env vars are not configured' });
    }

    const { firstName, lastName } = splitDisplayName(user.display_name);
    const userFirstName = user.first_name || firstName;
    const userLastName = user.last_name || lastName;

    const userData = {
      client_ip_address: getClientIpAddress(req),
      client_user_agent: req.headers['user-agent'] || '',
    };

    const emailHash = hashValue(user.email);
    const firstNameHash = hashValue(userFirstName);
    const lastNameHash = hashValue(userLastName);
    const externalIdHash = hashValue(user.id);

    if (emailHash) userData.em = [emailHash];
    if (firstNameHash) userData.fn = [firstNameHash];
    if (lastNameHash) userData.ln = [lastNameHash];
    if (externalIdHash) userData.external_id = [externalIdHash];
    if (typeof fbc === 'string' && fbc) userData.fbc = fbc;
    if (typeof fbp === 'string' && fbp) userData.fbp = fbp;

    const event = {
      event_name: eventName,
      event_time: Number.isFinite(Number(eventTime)) ? Number(eventTime) : Math.floor(Date.now() / 1000),
      event_source_url: eventSourceUrl || req.headers.referer || '',
      action_source: 'website',
      event_id: eventId,
      user_data: userData,
    };

    const resolvedSubscriptionId = subscriptionId || subscription_id;
    if (eventName === 'Subscribe' && resolvedSubscriptionId) {
      event.custom_data = { subscription_id: String(resolvedSubscriptionId) };
    }

    const metaResponse = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [event] }),
      }
    );

    let metaJson = null;
    try {
      metaJson = await metaResponse.json();
    } catch (_e) {}

    if (!metaResponse.ok) {
      console.error('meta-events: CAPI request failed', metaResponse.status, metaJson);
    }

    return res.status(200).json({ ok: metaResponse.ok, status: metaResponse.status, meta: metaJson });
  } catch (error) {
    console.error('meta-events: unexpected error', error);
    return res.status(200).json({ ok: false, skipped: true });
  }
}
