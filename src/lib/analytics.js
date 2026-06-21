import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

function isPosthogLoaded() {
  return Boolean(posthog && posthog.__loaded);
}

function safePosthogCall(method, ...args) {
  try {
    if (!isPosthogLoaded() || typeof posthog?.[method] !== 'function') return;
    posthog[method](...args);
  } catch (_error) {}
}

export function initAnalytics() {
  if (!POSTHOG_KEY) return;

  try {
    if (typeof posthog?.init !== 'function') return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false,
      capture_pageleave: true,
      session_recording: {
        maskAllInputs: true,
      },
      autocapture: true,
      // Avoid loading optional external PostHog extensions (often blocked by ad blockers).
      // Core analytics still work, and blocked extension scripts won't affect app flow.
      disable_external_dependency_loading: true,
      loaded: (ph) => {
        try {
          if (import.meta.env.DEV && typeof ph?.debug === 'function') ph.debug();
        } catch (_error) {}
      },
    });
  } catch (_error) {}
}

export function trackEvent(name, props) {
  safePosthogCall('capture', name, props);
}

export function identifyUser(userId, traits) {
  safePosthogCall('identify', userId, traits);
}

export function trackPageView(path) {
  safePosthogCall('capture', '$pageview', { path });
}

export function trackPageLeave(path) {
  safePosthogCall('capture', '$pageleave', { path });
}

export function stopAnalytics() {
  safePosthogCall('opt_out_capturing');
}
