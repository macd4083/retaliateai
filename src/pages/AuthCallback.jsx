import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSafeAuthReturn, getAuthLinkError, resolveAuthCallbackSession } from '../lib/authReturn';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../lib/AuthContext';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { isPasswordRecovery } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = getSafeAuthReturn(searchParams.get('next'));
  const [status, setStatus] = useState('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handleCallback = async () => {
      try {
        const linkError = getAuthLinkError(window.location.search, window.location.hash);
        if (linkError) throw new Error(linkError);
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        if (fragment.get('type') === 'recovery' || searchParams.get('type') === 'recovery') {
          navigate(`/auth/reset-password${window.location.search}${window.location.hash}`, { replace: true });
          return;
        }
        // Preserve implicit links, and explicitly exchange PKCE only if no session exists.
        const { data, error } = await resolveAuthCallbackSession(supabase.auth, searchParams.get('code'));
        if (cancelled || isPasswordRecovery?.()) return;
        if (error) throw error;
        if (data?.session) {
          setStatus('success');
          navigate(returnTo, { replace: true });
        } else {
          throw new Error('The link may be expired or invalid. Please sign in or request a new link.');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Callback error:', err);
        setErrorMessage(err?.message || 'Unable to complete sign in.');
        setStatus('error');
      }
    };

    handleCallback();
    return () => { cancelled = true; };
  }, [navigate, returnTo, searchParams, isPasswordRecovery]);

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
            <p className="text-zinc-400 mb-6">{errorMessage}</p>
            <button
              onClick={() => navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true })}
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