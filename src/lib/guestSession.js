/**
 * lib/guestSession.js
 *
 * Utilities for the Instagram guest-campaign onboarding flow.
 * Captures UTM/attribution params on /start/guest entry and persists them
 * in sessionStorage long enough for post-session attribution.
 */

const GUEST_ATTRIBUTION_KEY = 'retaliate_guest_attribution';

/** Extract known attribution params from a URLSearchParams object. */
export function extractAttribution(searchParams) {
  const pick = (k) => searchParams.get(k) || undefined;
  const attr = {
    src: pick('src'),
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_content: pick('utm_content'),
    utm_term: pick('utm_term'),
  };
  // Remove undefined keys to keep the object lean
  return Object.fromEntries(Object.entries(attr).filter(([, v]) => v !== undefined));
}

/** Persist attribution to sessionStorage. */
export function saveAttribution(attribution) {
  try {
    sessionStorage.setItem(GUEST_ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch (_e) {
    // sessionStorage unavailable (e.g. private browsing with restrictions) — fail silently
  }
}

/** Read back persisted attribution. Returns {} if nothing stored. */
export function readAttribution() {
  try {
    const raw = sessionStorage.getItem(GUEST_ATTRIBUTION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}
