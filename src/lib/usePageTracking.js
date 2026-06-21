import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageLeave, trackPageView } from './analytics';

export function usePageTracking() {
  const location = useLocation();
  const prevPathRef = useRef(null);

  useEffect(() => {
    if (prevPathRef.current && prevPathRef.current !== location.pathname) {
      trackPageLeave(prevPathRef.current);
    }

    trackPageView(location.pathname);
    prevPathRef.current = location.pathname;
  }, [location.pathname]);
}
