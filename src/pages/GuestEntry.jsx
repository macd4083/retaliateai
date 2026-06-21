import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { trackEvent, identifyUser } from '../lib/analytics';
import { extractAttribution, saveAttribution } from '../lib/guestSession';

/**
 * GuestEntry  –  route: /start/guest
 *
 * Entry point for Instagram campaign traffic.
 * 1. Captures UTM / src attribution params and persists them for post-session use.
 * 2. Signs in anonymously via Supabase so the full reflection flow works without signup.
 * 3. Marks the anonymous profile as a guest campaign user.
 * 4. Redirects into the normal first-session reflection flow.
 *
 * Query params supported: src, utm_source, utm_medium, utm_campaign, utm_content, utm_term
 */
export default function GuestEntry() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // ── 1. Capture + persist attribution ────────────────────────────────
      const attribution = extractAttribution(searchParams);
      saveAttribution(attribution);

      // ── 2. Analytics: landing view ───────────────────────────────────────
      trackEvent('guest_campaign_landing_view', attribution);

      // ── 3. Sign in anonymously (idempotent — re-use existing session) ────
      let userId;
      try {
        // If a valid session already exists (e.g. page refresh), use it
        const { data: existing } = await supabase.auth.getSession();
        if (existing?.session?.user?.id) {
          userId = existing.session.user.id;
        } else {
          const { data, error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
          userId = data.user?.id;
        }
      } catch (err) {
        console.error('[GuestEntry] anonymous sign-in failed:', err);
        if (!cancelled) setError('Unable to start your session. Please try again.');
        return;
      }

      if (!userId || cancelled) return;

      // Identify in analytics so subsequent events carry guest context
      identifyUser(userId, { is_guest_campaign_user: true, ...attribution });

      // ── 4. Mark user_profile as guest campaign user ──────────────────────
      // The trigger auto-created the profile row on sign-in; just update flags.
      supabase
        .from('user_profiles')
        .update({
          is_guest_campaign_user: true,
          campaign_attribution: attribution,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .then(({ error: updateError }) => {
          if (updateError) console.error('[GuestEntry] profile update failed:', updateError);
        });

      // ── 5. Route into the normal first-session flow ──────────────────────
      if (!cancelled) navigate('/reflection', { replace: true });
    }

    bootstrap();
    return () => { cancelled = true; };
  // searchParams is stable on mount — intentionally excluded from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-4 px-6 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-4">
      <div className="w-10 h-10 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      <p className="text-zinc-500 text-sm tracking-wide">Getting your session ready…</p>
    </div>
  );
}
