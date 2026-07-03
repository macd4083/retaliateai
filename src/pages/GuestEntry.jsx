import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { isMissingProfileColumn } from '../lib/supabase/profileSchema';
import { trackEvent, identifyUser } from '../lib/analytics';
import {
  buildSignupPath,
  evaluateGuestAccess,
  extractAttribution,
  GUEST_FALLBACK_REDIRECT_DELAY_MS,
  GUEST_MODE_UNAVAILABLE_MESSAGE,
  isAnonymousGuestUser,
  saveAttribution,
} from '../lib/guestSession';
import GuestSignupGate from '../components/GuestSignupGate';

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
  const [fallbackPath, setFallbackPath] = useState(null);
  const [showSignupGate, setShowSignupGate] = useState(false);
  const [gateAttribution, setGateAttribution] = useState({});

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
        const existingUser = existing?.session?.user;
        if (existingUser?.id && isAnonymousGuestUser(existingUser)) {
          userId = existingUser.id;
        } else {
          // /start/guest must always bootstrap an anonymous guest flow.
          // Clear any existing non-anonymous session first so stale auth state
          // cannot force onboarding redirects on /reflection.
          if (existingUser?.id) {
            const { error: signOutError } = await supabase.auth.signOut();
            if (signOutError) {
              console.error('[GuestEntry] sign-out before guest bootstrap failed:', signOutError);
              throw signOutError;
            }
          }
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
            setError(GUEST_MODE_UNAVAILABLE_MESSAGE);
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

      // ── 4. Gate: first-session completion flag only ───────────────────────
      let guestProfile = null;
      try {
        const { data: gateData, error: gateError } = await supabase
          .from('user_profiles')
          .select('requires_signup_for_next_session, guest_usage_count')
          .eq('id', userId)
          .maybeSingle();

        if (!gateError) {
          guestProfile = gateData;
          const accessResult = evaluateGuestAccess(gateData);
          if (accessResult === 'require_signup') {
            trackEvent('guest_return_signup_gated', { guest_id: userId, ...attribution });
            if (!cancelled) {
              setGateAttribution(attribution);
              setShowSignupGate(true);
            }
            return;
          }
        } else if (gateError?.code !== 'PGRST204') {
          // Only log genuinely unexpected errors; PGRST204 means a column is missing
          // (schema not yet deployed) and we fall through to allow the guest session.
          console.error('[GuestEntry] gate check failed:', gateError);
        }
      } catch (gateErr) {
        console.error('[GuestEntry] gate check threw:', gateErr);
      }

      // Identify in analytics so subsequent events carry guest context
      identifyUser(userId, { is_guest_campaign_user: true, ...attribution });

      // ── 5. Mark user_profile as guest campaign user ──────────────────────
      // The trigger auto-created the profile row on sign-in; just update flags.
      const updateTimestamp = new Date().toISOString();
      const isFirstVisit = typeof guestProfile?.guest_usage_count !== 'number';

      const profileFields = {
        is_guest_campaign_user: true,
        updated_at: updateTimestamp,
      };

      profileFields.guest_usage_count = isFirstVisit ? 1 : (guestProfile?.guest_usage_count || 0) + 1;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(profileFields)
        .eq('id', userId);

      // Older DB schemas may not have guest campaign fields yet.
      // Fall back to a minimal update so guest navigation never blocks on profile shape.
      if (updateError) {
        if (updateError?.code === 'PGRST204') {
          // Try without optional guest fields (schema may not have them yet)
          const { error: guestFlagError } = await supabase
            .from('user_profiles')
            .update({ is_guest_campaign_user: true, updated_at: updateTimestamp })
            .eq('id', userId);
          if (guestFlagError) {
            if (isMissingProfileColumn(guestFlagError, 'is_guest_campaign_user')) {
              const { error: fallbackError } = await supabase
                .from('user_profiles')
                .update({ updated_at: updateTimestamp })
                .eq('id', userId);
              if (fallbackError) {
                console.error('[GuestEntry] profile fallback update failed:', fallbackError);
              }
            } else {
              console.error('[GuestEntry] profile update failed:', guestFlagError);
            }
          }
        } else {
          console.error('[GuestEntry] profile update failed:', updateError);
        }
      }

      // ── 6. Route into the normal first-session flow ──────────────────────
      if (!cancelled) navigate('/reflection', { replace: true });
    }

    bootstrap();
    return () => {
      cancelled = true;
      if (redirectTimer) {
        window.clearTimeout(redirectTimer);
      }
    };
  // searchParams is stable on mount — intentionally excluded from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (showSignupGate) {
    return (
      <GuestSignupGate
        attribution={gateAttribution}
        mode="fullscreen"
        context="guest_entry_gate"
        title="Create your account to continue"
        body="Your guest reflection is complete. Create your account to save your progress and keep your momentum tomorrow."
        ctaLabel="Create account"
        secondaryLabel="Log in"
      />
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-4 px-6 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => {
            if (fallbackPath) {
              navigate(fallbackPath, { replace: true });
              return;
            }
            window.location.reload();
          }}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          {fallbackPath ? 'Continue with Free Trial' : 'Try Again'}
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
