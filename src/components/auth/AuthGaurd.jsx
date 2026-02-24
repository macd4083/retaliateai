import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase/client';
import Onboarding from '../../pages/Onboarding';

export default function AuthGuard({ children }) {
  const { user, loading } = useAuth();
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    async function checkOnboardingStatus() {
      if (!user) {
        setCheckingOnboarding(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('onboarding_completed')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error checking onboarding:', error);
          setOnboardingComplete(false);
        } else {
          setOnboardingComplete(data?.onboarding_completed || false);
        }
      } catch (error) {
        console.error('Error:', error);
        setOnboardingComplete(false);
      } finally {
        setCheckingOnboarding(false);
      }
    }

    checkOnboardingStatus();
  }, [user]);

  if (loading || checkingOnboarding) {
    return (
      <div className="flex items-center justify-center h-screen bg-red-50">
        <div className="text-center">
          <div className="relative mx-auto mb-4 h-20 w-20">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                borderWidth: 4,
                borderStyle: 'solid',
                borderColor: 'rgba(148,163,184,0.45)',
                borderTopColor: 'rgba(220,38,38,0.85)',
                animation: 'spin 0.9s linear infinite',
              }}
            />
          </div>
          <p className="text-slate-700 font-medium">Loading...</p>
        </div>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!onboardingComplete) {
    return <Onboarding onComplete={() => setOnboardingComplete(true)} />;
  }

  return children;
}