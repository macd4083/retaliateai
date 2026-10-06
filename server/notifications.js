import { timingSafeEqual } from 'node:crypto';

// Verified against public/sitemap.xml; never derive outbound links from request headers.
export function publicAppUrl(path) {
  const configured = process.env.PUBLIC_APP_ORIGIN || 'https://retaliateai.com';
  const origin = new URL(configured);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('PUBLIC_APP_ORIGIN must be an HTTP(S) origin');
  }
  return new URL(path, origin.origin).href;
}

export function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (!secret || typeof authorization !== 'string') return false;
  const expected = Buffer.from('Bearer ' + secret);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const REVIEW_REMINDER_TITLE = 'Retaliate AI';
export const REVIEW_REMINDER_BODY = 'Review today and prepare tomorrow.';

export function getServerDayBoundaryHour() {
  // V2's localStorage override is not persisted to profiles. Server reminders use
  // the deployment-wide V2 setting (default 4 AM), not a fabricated user preference.
  const value = process.env.VITE_TODAY_V2_DAY_BOUNDARY_HOUR;
  const hour = value == null || value.trim() === '' ? NaN : Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 4;
}

export function getLocalReviewContext(now, timezone, boundaryHour = getServerDayBoundaryHour()) {
  if (typeof timezone !== 'string' || !timezone.trim()) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    // Calendar arithmetic, not elapsed 24-hour intervals, preserves local dates at DST.
    const anchor = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
    if (Number(parts.hour) < boundaryHour) anchor.setUTCDate(anchor.getUTCDate() - 1);
    const reviewDate = anchor.toISOString().slice(0, 10);
    anchor.setUTCDate(anchor.getUTCDate() - 1);
    const yesterday = anchor.toISOString().slice(0, 10);
    anchor.setUTCDate(anchor.getUTCDate() - 1);
    return {
      reviewDate,
      missedDates: [yesterday, anchor.toISOString().slice(0, 10)],
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  } catch {
    return null;
  }
}
