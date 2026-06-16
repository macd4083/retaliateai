import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import posthog from 'posthog-js';

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    if (!posthog.__loaded) return;
    posthog.capture('$pageview', { path: location.pathname });
  }, [location.pathname]);
}
