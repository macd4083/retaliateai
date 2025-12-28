import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    // Track page views here if needed
    console.log('Page viewed:', location.pathname);
  }, [location]);

  return null;
}