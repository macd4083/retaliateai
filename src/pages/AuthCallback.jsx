import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Exchange PKCE code / magic-link token from the URL for a session
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);

        if (error) {
          console.error('Auth error:', error);
          setStatus('error');
          return;
        }

        // Listen for the session to be confirmed
        let subscription;
        ({ data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (session) {
            subscription.unsubscribe();
            setStatus('success');
            // AuthGuardV2 will handle the onboarding redirect automatically
            navigate('/reflection', { replace: true });
          }
        }));

        // Also check immediately in case the session is already set
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          subscription.unsubscribe();
          setStatus('success');
          navigate('/reflection', { replace: true });
        }
      } catch (err) {
        console.error('Callback error:', err);
        setStatus('error');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center">
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {status === 'verifying' && (
          <>
            <div className="relative mx-auto mb-6 h-20 w-20">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  borderWidth: 4,
                  borderStyle: 'solid',
                  borderColor: 'rgba(63,63,70,0.8)',
                  borderTopColor: '#dc2626',
                  animation: 'spin 0.9s linear infinite',
                }}
              />
            </div>
            <p className="text-white font-medium">Verifying your email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-red-500 text-5xl mb-4">✓</div>
            <p className="text-white font-semibold mb-2">Email confirmed!</p>
            <p className="text-zinc-400">Redirecting...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-red-500 text-5xl mb-4">✗</div>
            <p className="text-white font-semibold mb-2">Verification failed</p>
            <p className="text-zinc-400 mb-6">The link may be expired or invalid.</p>
            <button
              onClick={() => navigate('/login')}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors"
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}