import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// ── V2 pages (new) ─────────────────────────────────────────────────────────
import ReflectionV2 from './pages/ReflectionV2';
import InsightsV2 from './pages/InsightsV2';
import SettingsV2 from './pages/SettingsV2';
import OnboardingV2 from './pages/OnboardingV2';
import AdminV2 from './pages/AdminV2';
import VideoExport from './pages/admin/VideoExport';
import DemoBuilder from './pages/DemoBuilder';
import DemoPlayerPage from './pages/DemoPlayerPage';
import UIRecorder from './pages/UIRecorder';
import UIEditor from './pages/UIEditor';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import EmailConfirmed from './pages/EmailConfirmed';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Landing from './pages/Landing';

import { useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabase/client';

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
function AuthGuardV2({ children }) {
  const { user, loading } = useAuth();

  // FIX: Start as null (unknown), not false.
  // null = "haven't checked yet" → show loading screen
  // false = "checked, not completed" → show onboarding
  // true = "checked, completed" → show app
  const [onboardingCompleted, setOnboardingCompleted] = React.useState(null);
  const [profileLoading, setProfileLoading] = React.useState(true);

  React.useEffect(() => {
    // If auth is still resolving, don't do anything yet
    if (loading) return;

    if (!user?.id) {
      setProfileLoading(false);
      setOnboardingCompleted(false);
      return;
    }

    supabase
      .from('user_profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setOnboardingCompleted(data?.onboarding_completed ?? false);
        setProfileLoading(false);
      });
  }, [user?.id, loading]); // FIX: also depend on loading so we wait for auth to settle

  // Show loading screen until BOTH auth AND profile check are done.
  // onboardingCompleted === null means we haven't gotten the answer yet.
  if (loading || profileLoading || onboardingCompleted === null) {
    return <LoadingScreen />;
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!onboardingCompleted) {
    return (
      <OnboardingV2
        onOnboardingComplete={() => setOnboardingCompleted(true)}
      />
    );
  }

  return children;
}

// ── App ──────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<EmailConfirmed />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/" element={<Landing />} />
      <Route path="/demo/:id" element={<DemoPlayerPage />} />

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
        path="/admin/video-export"
        element={
          <AuthGuardV2>
            <VideoExport />
          </AuthGuardV2>
        }
      />
      <Route
        path="/video-export"
        element={
          <AuthGuardV2>
            <VideoExport />
          </AuthGuardV2>
        }
      />
      <Route
        path="/admin/demo-builder"
        element={
          <AuthGuardV2>
            <DemoBuilder />
          </AuthGuardV2>
        }
      />
      <Route
        path="/demo-builder"
        element={
          <AuthGuardV2>
            <DemoBuilder />
          </AuthGuardV2>
        }
      />
      <Route
        path="/recorder"
        element={
          <AuthGuardV2>
            <UIRecorder />
          </AuthGuardV2>
        }
      />
      <Route
        path="/ui-editor"
        element={
          <AuthGuardV2>
            <UIEditor />
          </AuthGuardV2>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/reflection" replace />} />
    </Routes>
  );
}
