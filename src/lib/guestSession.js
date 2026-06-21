/**
 * lib/guestSession.js
 *
 * Utilities for the Instagram guest-campaign onboarding flow.
 * Captures UTM/attribution params on /start/guest entry and persists them
 * in sessionStorage long enough for post-session attribution.
 */

const GUEST_ATTRIBUTION_KEY = 'retaliate_guest_attribution';
const ATTRIBUTION_KEYS = ['src', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export const GUEST_MODE_UNAVAILABLE_MESSAGE = 'Guest mode is unavailable right now. Continue with your free trial.';
export const GUEST_FALLBACK_REDIRECT_DELAY_MS = 1200;

/** Normalizes route/query input into a URLSearchParams instance. */
function normalizeSearchParams(searchParams) {
  if (searchParams instanceof URLSearchParams) return searchParams;
  if (typeof searchParams === 'string') return new URLSearchParams(searchParams);
  if (searchParams && typeof searchParams === 'object') {
    return new URLSearchParams(
      Object.entries(searchParams).filter(([, value]) => value !== undefined && value !== null)
    );
  }
  return new URLSearchParams();
}

/** Returns a trimmed attribution value or undefined when it is not usable. */
function cleanAttributionValue(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function sanitizeAttribution(attribution) {
  if (!attribution || typeof attribution !== 'object') return {};

  return Object.fromEntries(
    ATTRIBUTION_KEYS
      .map((key) => [key, cleanAttributionValue(attribution[key])])
      .filter(([, value]) => value !== undefined)
  );
}

/** Extract known attribution params from a URLSearchParams object. */
export function extractAttribution(searchParams) {
  const params = normalizeSearchParams(searchParams);
  return sanitizeAttribution(
    Object.fromEntries(ATTRIBUTION_KEYS.map((key) => [key, params.get(key)]))
  );
}

export function buildSignupPath(attribution = {}, extraParams = {}) {
  const params = new URLSearchParams();
  params.set('signup', 'true');

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });

  Object.entries(sanitizeAttribution(attribution)).forEach(([key, value]) => {
    params.set(key, value);
  });

  return `/login?${params.toString()}`;
}

/** Persist attribution to sessionStorage. */
export function saveAttribution(attribution) {
  try {
    sessionStorage.setItem(GUEST_ATTRIBUTION_KEY, JSON.stringify(sanitizeAttribution(attribution)));
  } catch (_e) {
    // sessionStorage unavailable (e.g. private browsing with restrictions) — fail silently
  }
}

/** Read back persisted attribution. Returns {} if nothing stored. */
export function readAttribution() {
  try {
    const raw = sessionStorage.getItem(GUEST_ATTRIBUTION_KEY);
    return raw ? sanitizeAttribution(JSON.parse(raw)) : {};
  } catch (_e) {
    return {};
  }
}
