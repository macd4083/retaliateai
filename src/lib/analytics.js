import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

export function initAnalytics() {
  if (!POSTHOG_KEY) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    session_recording: {
      maskAllInputs: true,
    },
    autocapture: true,
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
    },
  });
}

export function trackEvent(name, props) {
  if (!posthog.__loaded) return;
  posthog.capture(name, props);
}

export function identifyUser(userId, traits) {
  if (!posthog.__loaded) return;
  posthog.identify(userId, traits);
}

export function stopAnalytics() {
  if (!posthog.__loaded) return;
  posthog.opt_out_capturing();
}
