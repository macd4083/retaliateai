import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import posthog from 'posthog-js';

export function usePageTracking() {
  const location = useLocation();
  const prevPathRef = useRef(null);

  useEffect(() => {
    if (!posthog.__loaded) return;

    if (prevPathRef.current && prevPathRef.current !== location.pathname) {
      posthog.capture('$pageleave', { path: prevPathRef.current });
    }

    posthog.capture('$pageview', { path: location.pathname });
    prevPathRef.current = location.pathname;
  }, [location.pathname]);
}
