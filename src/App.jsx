import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// ── V2 pages (new) ─────────────────────────────────────────────────────────
import ReflectionV2 from './pages/ReflectionV2';
import InsightsV2 from './pages/InsightsV2';
import SettingsV2 from './pages/SettingsV2';
import OnboardingV2 from './pages/OnboardingV2';
import AdminV2 from './pages/AdminV2';
import AdminFeedback from './pages/AdminFeedback';
import AdminSessionLog from './pages/AdminSessionLog';
import LiveDemo from './pages/admin/LiveDemo';
import LiveDemoInsights from './pages/admin/LiveDemoInsights';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import EmailConfirmed from './pages/EmailConfirmed';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Landing from './pages/Landing';
import TrialExpiredModal from './components/TrialExpiredModal';
import GuestEntry from './pages/GuestEntry';
import PostSessionNextSteps from './pages/PostSessionNextSteps';

import { useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabase/client';
import { usePageTracking } from './lib/usePageTracking';
import { stopAnalytics } from './lib/analytics';
import {
  buildSignupPath,
  evaluateGuestAccess,
  fetchGuestGuardrailsEnabled,
  readAttribution,
} from './lib/guestSession';
import { shouldShowTrialExpiredModal } from './lib/trialModal';
import { isMissingProfileColumn } from './lib/supabase/profileSchema';

const PROFILE_BASE_FIELDS = ['onboarding_completed', 'trial_ends_at', 'subscription_status', 'feedback_submitted', 'trial_extended', 'role'];
const PROFILE_FIELDS_BASE = PROFILE_BASE_FIELDS.join(', ');
const PROFILE_FIELDS_WITH_GUEST_FLAGS = [
  ...PROFILE_BASE_FIELDS,
  'is_guest_campaign_user',
  'requires_signup_for_next_session',
  'guest_started_at',
  'guest_cooldown_until',
].join(', ');

async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_FIELDS_WITH_GUEST_FLAGS)
    .eq('id', userId)
    .maybeSingle();

  if (!error) return { data, error: null };

  const missingGuestColumns =
    isMissingProfileColumn(error, 'is_guest_campaign_user') ||
    isMissingProfileColumn(error, 'requires_signup_for_next_session') ||
    isMissingProfileColumn(error, 'guest_started_at') ||
    isMissingProfileColumn(error, 'guest_cooldown_until');

  if (!missingGuestColumns) return { data: null, error };

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('user_profiles')
    .select(PROFILE_FIELDS_BASE)
    .eq('id', userId)
    .maybeSingle();

  if (fallbackError) return { data: null, error: fallbackError };

  if (fallbackData) {
    console.warn('[AuthGuardV2] guest profile columns unavailable; using base profile fields');
  }

  return {
    data: fallbackData
      ? {
          ...fallbackData,
          is_guest_campaign_user: undefined,
          requires_signup_for_next_session: undefined,
          guest_started_at: undefined,
          guest_cooldown_until: undefined,
        }
      : null,
    error: null,
  };
}

export function isGuestCampaignUser(profileData, user) {
  return profileData?.is_guest_campaign_user === true || user?.is_anonymous === true;
}

// ── Old imports (preserved, not deleted) ────────────────────────────────────
// import Sidebar from './components/layout/Sidebar';
// import JournalEditor from './components/journal/JournalEditor';
// import EntryDetailModal from './components/journal/EntryDetailModal';
// import Gratitude from './pages/Gratitude';
// import Insights from './pages/Insights';
// import Goals from './pages/Goals';
// import GoalDetail from './pages/GoalDetail';
// import Users from './pages/Users';
// import Reflection from './pages/Reflection';
// import {
//   useJournalEntries,
//   useCreateJournalEntry,
//   useUpdateJournalEntry,
//   useDeleteJournalEntry,
// } from './hooks';

// ── Full-screen loading screen ────────────────────────────────────────────
// FIX: Proper branded loading screen shown while auth + onboarding status resolves.
// Prevents any flash of onboarding or wrong content during initial load.
function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-4">
      <div className="w-10 h-10 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      <p className="text-zinc-500 text-sm tracking-wide">Loading...</p>
    </div>
  );
}

// ── AuthGuardV2 ───────────────────────────────────────────────────────────
// Checks auth + onboarding_completed. If not onboarded, shows OnboardingV2.
// Guest campaign users (anonymous Supabase users from /start/guest) bypass
// onboarding on first visit, and see a signup gate if they try a second session.
function AuthGuardV2({ children }) {
  const { user, loading } = useAuth();

  // FIX: Start as null (unknown), not false.
  // null = "haven't checked yet" → show loading screen
  // false = "checked, not completed" → show onboarding
  // true = "checked, completed" → show app
  const [onboardingCompleted, setOnboardingCompleted] = React.useState(null);
  const [profileData, setProfileData] = React.useState(null);
  const [profileLoading, setProfileLoading] = React.useState(true);
  const [feedbackDismissed, setFeedbackDismissed] = React.useState(false);
  const [guardrailsEnabled, setGuardrailsEnabled] = React.useState(true);

  React.useEffect(() => {
    setFeedbackDismissed(false);
  }, [user?.id]);

  React.useEffect(() => {
    // If auth is still resolving, don't do anything yet
    if (loading) return;
    // Lives in effect scope so cleanup can cancel stale async profile requests.
    let cancelled = false;

    if (!user?.id) {
      setProfileLoading(false);
      setOnboardingCompleted(false);
      setGuardrailsEnabled(true);
      return;
    }

    async function loadProfile() {
      const [{ data, error }, nextGuardrailsEnabled] = await Promise.all([
        fetchUserProfile(user.id),
        fetchGuestGuardrailsEnabled(supabase),
      ]);
      if (cancelled) return;
      if (error) {
        console.error('[AuthGuardV2] profile load failed:', error);
      }

      const completed = data?.onboarding_completed ?? false;
      setGuardrailsEnabled(nextGuardrailsEnabled);
      setOnboardingCompleted(completed);
      // Stop tracking for users who have already completed onboarding
      if (completed) stopAnalytics();
      setProfileData(data || null);
      setProfileLoading(false);
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.id, loading]); // FIX: also depend on loading so we wait for auth to settle

  // Show loading screen until BOTH auth AND profile check are done.
  // onboardingCompleted === null means we haven't gotten the answer yet.
  if (loading || profileLoading || onboardingCompleted === null) {
    return <LoadingScreen />;
  }

  if (!user) return <Navigate to="/login" replace />;

  // Guest campaign users who have already completed their first session: show signup gate.
  // user.is_anonymous === true distinguishes anonymous (guest) users from signed-up users.
  const isGuestUser = isGuestCampaignUser(profileData, user);
  const accessResult = evaluateGuestAccess(profileData, { guardrailsEnabled });

  if (
    isGuestUser &&
    user?.is_anonymous === true &&
    (accessResult === 'cooldown' || accessResult === 'require_signup')
  ) {
    // Returning guest or guest in cooldown: redirect to the signup page, preserving any attribution.
    return <Navigate to={buildSignupPath(readAttribution())} replace />;
  }

  // Guest campaign users bypass onboarding — go straight to the session.
  if (!onboardingCompleted && !isGuestUser) {
    return (
      <OnboardingV2
        onOnboardingComplete={() => {
          stopAnalytics();
          setOnboardingCompleted(true);
        }}
      />
    );
  }

  const showFeedbackModal = shouldShowTrialExpiredModal(profileData, {
    feedbackDismissed,
    isGuestUser,
  });

  return (
    <>
      {children}
      {showFeedbackModal && (
        <TrialExpiredModal
          isSecondExpiry={extendedTrialExpired}
          onFeedbackExtended={(newTrialEndsAt) => {
            setFeedbackDismissed(true);
            setProfileData((prev) => ({
              ...(prev || {}),
              trial_ends_at: newTrialEndsAt || prev?.trial_ends_at,
              feedback_submitted: true,
              trial_extended: true,
            }));
          }}
        />
      )}
    </>
  );
}

// ── App ──────────────────────────────────────────────────────────────────
export default function App() {
  usePageTracking();

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<EmailConfirmed />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/" element={<Landing />} />

      {/* Instagram guest-campaign entry — bootstraps anonymous session */}
      <Route path="/start/guest" element={<GuestEntry />} />

      {/* Post-session conversion page — public (guest arrives here after first session) */}
      <Route path="/post-session/next-steps" element={<PostSessionNextSteps />} />

      {/* V2 protected routes */}
      <Route
        path="/reflection"
        element={
          <AuthGuardV2>
            <ReflectionV2 />
          </AuthGuardV2>
        }
      />
      <Route
        path="/insights"
        element={
          <AuthGuardV2>
            <InsightsV2 />
          </AuthGuardV2>
        }
      />
      <Route
        path="/settings"
        element={
          <AuthGuardV2>
            <SettingsV2 />
          </AuthGuardV2>
        }
      />

      <Route
        path="/admin"
        element={
          <AuthGuardV2>
            <AdminV2 />
          </AuthGuardV2>
        }
      />
      <Route
        path="/admin/feedback"
        element={
          <AuthGuardV2>
            <AdminFeedback />
          </AuthGuardV2>
        }
      />
      <Route
        path="/admin/session-log"
        element={
          <AuthGuardV2>
            <AdminSessionLog />
          </AuthGuardV2>
        }
      />
      <Route
        path="/admin/live-demo"
        element={
          <AuthGuardV2>
            <LiveDemo />
          </AuthGuardV2>
        }
      />
      <Route
        path="/admin/live-demo/insights"
        element={
          <AuthGuardV2>
            <LiveDemoInsights />
          </AuthGuardV2>
        }
      />
      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/reflection" replace />} />
    </Routes>
  );
}
