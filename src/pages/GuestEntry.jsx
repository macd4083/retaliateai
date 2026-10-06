import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { trackEvent } from '../lib/analytics';
import { buildSignupPath, extractAttribution, saveAttribution } from '../lib/guestSession';

export default function GuestEntry() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const attribution = extractAttribution(searchParams);
    saveAttribution(attribution);
    trackEvent('guest_campaign_landing_view', attribution);
    // Keep any historical anonymous session intact for the signup data transfer.
    navigate(buildSignupPath(attribution, { guest: 'unavailable' }), { replace: true });
  }, [navigate, searchParams]);

  return (
    <div className="flex items-center justify-center h-screen bg-zinc-950 px-6 text-center">
      <p className="text-zinc-400 text-sm">Create an account to start your review and plan.</p>
    </div>
  );
}
