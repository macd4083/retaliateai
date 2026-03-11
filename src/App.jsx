import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// ── V2 pages (new) ─────────────────────────────────────────────────────────
import ReflectionV2 from './pages/ReflectionV2';
import InsightsV2 from './pages/InsightsV2';
import SettingsV2 from './pages/SettingsV2';
import OnboardingV2 from './pages/OnboardingV2';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import EmailConfirmed from './pages/EmailConfirmed';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';

import { useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabase/client';

// ── Old imports (preserved, not deleted) ──────────────────────────────────
// import Sidebar from './components/layout/Sidebar';
// import JournalEditor from './components/journal/JournalEditor';
// import EntryDetailModal from './components/journal/EntryDetailModal';
// import Clarity from './pages/Clarity';
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

// ── AuthGuardV2 ────────────────────────────────────────────────────────────
// Checks auth + onboarding_completed. If not onboarded, shows OnboardingV2.
function AuthGuardV2({ children }) {
  const { user, loading } = useAuth();
  const [onboardingCompleted, setOnboardingCompleted] = React.useState(null);
  const [profileLoading, setProfileLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.id) {
      setProfileLoading(false);
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
  }, [user?.id]);

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!onboardingCompleted) return <OnboardingV2 />;

  return children;
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<EmailConfirmed />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />

      {/* V2 protected routes */}
      <Route
        path="/"
        element={
          <AuthGuardV2>
            <Navigate to="/reflection" replace />
          </AuthGuardV2>
        }
      />
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

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/reflection" replace />} />
    </Routes>
  );
}
