import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { isMissingProfileColumn } from '../lib/supabase/profileSchema';
import { trackEvent, identifyUser } from '../lib/analytics';
import {
  buildSignupPath,
  extractAttribution,
  GUEST_FALLBACK_REDIRECT_DELAY_MS,
  GUEST_MODE_UNAVAILABLE_MESSAGE,
  saveAttribution,
} from '../lib/guestSession';

/**
 * Detects the Supabase error shape returned when anonymous auth is disabled.
 * Supabase currently surfaces this as a 422 plus an "Anonymous sign-ins are disabled"
 * message, so the message match remains as a compatibility fallback.
 *
 * @param {unknown} authError
 * @returns {boolean}
 */
function isAnonymousAuthDisabled(authError) {
  const message = String(
    authError?.message ||
    authError?.error_description ||
    authError?.details ||
    authError ||
    ''
  ).toLowerCase();

  return (
    message.includes('anonymous sign-ins are disabled') ||
    message.includes('anonymous sign ins are disabled') ||
    (authError?.status === 422 && message.includes('anonymous'))
  );
}

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
  const [fallbackPath, setFallbackPath] = useState('');
  const [fallbackMessage, setFallbackMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let redirectTimer;

    async function bootstrap() {
      // ── 1. Capture + persist attribution ────────────────────────────────
      const attribution = extractAttribution(searchParams);
      saveAttribution(attribution);
      const nextSignupPath = buildSignupPath(attribution, { guest: 'unavailable' });

      // ── 2. Analytics: landing view ───────────────────────────────────────
      trackEvent('guest_campaign_landing_view', attribution);

      // ── 3. Sign in anonymously (idempotent — re-use existing session) ────
      let userId;
      try {
        // If a valid session already exists (e.g. page refresh), use it
        const { data: existing, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (existing?.session?.user?.id) {
          userId = existing.session.user.id;
        } else {
          const { data, error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
          userId = data?.user?.id;
        }
      } catch (err) {
        console.error('[GuestEntry] anonymous sign-in failed:', err);
        if (isAnonymousAuthDisabled(err)) {
          trackEvent('guest_campaign_guest_mode_unavailable', attribution);
          if (!cancelled) {
            setFallbackPath(nextSignupPath);
            setFallbackMessage(GUEST_MODE_UNAVAILABLE_MESSAGE);
            redirectTimer = window.setTimeout(() => {
              navigate(nextSignupPath, { replace: true });
            }, GUEST_FALLBACK_REDIRECT_DELAY_MS);
          }
          return;
        }
        if (!cancelled) setError('Unable to start your session. Please try again.');
        return;
      }

      if (!userId || cancelled) return;

      // Identify in analytics so subsequent events carry guest context
      identifyUser(userId, { is_guest_campaign_user: true, ...attribution });

      // ── 4. Mark user_profile as guest campaign user ──────────────────────
      // The trigger auto-created the profile row on sign-in; just update flags.
      const updateTimestamp = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          is_guest_campaign_user: true,
          updated_at: updateTimestamp,
        })
        .eq('id', userId);

      // Older DB schemas may not have guest campaign fields yet.
      // Fall back to a minimal update so guest navigation never blocks on profile shape.
      if (updateError) {
        if (isMissingProfileColumn(updateError, 'is_guest_campaign_user')) {
          const { error: fallbackError } = await supabase
            .from('user_profiles')
            .update({ updated_at: updateTimestamp })
            .eq('id', userId);
          if (fallbackError) {
            console.error('[GuestEntry] profile fallback update failed:', fallbackError);
          }
        } else {
          console.error('[GuestEntry] profile update failed:', updateError);
        }
      }

      // ── 5. Route into the normal first-session flow ──────────────────────
      if (!cancelled) navigate('/reflection', { replace: true });
    }

    bootstrap();
    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
    };
  // searchParams is stable on mount — intentionally excluded from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fallbackMessage) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-4 px-6 text-center">
        <p className="text-amber-300 text-sm max-w-sm">{fallbackMessage}</p>
        <button
          onClick={() => navigate(fallbackPath, { replace: true })}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          Continue with Free Trial
        </button>
        <p className="text-zinc-500 text-xs">Redirecting you now…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-4 px-6 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
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
