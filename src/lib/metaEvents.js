function generateEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getCookieValue(name) {
  if (typeof document === 'undefined') return '';
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function splitDisplayName(displayName) {
  const cleaned = String(displayName || '').trim();
  if (!cleaned) return { first_name: '', last_name: '' };
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
  };
}

function buildUserPayload(user = {}) {
  const splitName = splitDisplayName(user.display_name || user.full_name);
  return {
    id: user.id || '',
    email: user.email || '',
    display_name: user.display_name || user.full_name || '',
    first_name: user.first_name || splitName.first_name,
    last_name: user.last_name || splitName.last_name,
  };
}

function trackBrowserPixel(eventName, eventId, parameters = {}) {
  try {
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    window.fbq('track', eventName, parameters, { eventID: eventId });
  } catch (_e) {}
}

async function sendServerEvent(payload) {
  try {
    await fetch('/api/meta-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (_e) {}
}

export function trackCompleteRegistration(user = {}) {
  try {
    const eventId = generateEventId();
    const normalizedUser = buildUserPayload(user);

    trackBrowserPixel('CompleteRegistration', eventId);
    sendServerEvent({
      eventName: 'CompleteRegistration',
      eventId,
      eventTime: Math.floor(Date.now() / 1000),
      eventSourceUrl: typeof window !== 'undefined' ? window.location.href : '',
      user: normalizedUser,
      fbc: getCookieValue('_fbc'),
      fbp: getCookieValue('_fbp'),
    });
  } catch (_e) {}
}

export function trackSubscribe(user = {}, subscriptionId) {
  try {
    const eventId = generateEventId();
    const normalizedUser = buildUserPayload(user);
    const safeSubscriptionId = subscriptionId ? String(subscriptionId) : '';

    trackBrowserPixel('Subscribe', eventId, {
      subscription_id: safeSubscriptionId || undefined,
    });
    sendServerEvent({
      eventName: 'Subscribe',
      eventId,
      eventTime: Math.floor(Date.now() / 1000),
      eventSourceUrl: typeof window !== 'undefined' ? window.location.href : '',
      user: normalizedUser,
      fbc: getCookieValue('_fbc'),
      fbp: getCookieValue('_fbp'),
      subscriptionId: safeSubscriptionId,
    });
  } catch (_e) {}
}
