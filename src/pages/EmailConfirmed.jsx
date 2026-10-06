import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { CheckCircle, X } from 'lucide-react';
import { getSafeAuthReturn, getAuthLinkError } from '../lib/authReturn';

export default function EmailConfirmed() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = getSafeAuthReturn(searchParams.get('next'));
  const [status, setStatus] = useState('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handleEmailConfirmation = async () => {
      try {
        const linkError = getAuthLinkError(window.location.search, window.location.hash);
        if (linkError) throw new Error(linkError);
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        if (fragment.get('type') === 'recovery' || searchParams.get('type') === 'recovery') {
          navigate(`/auth/reset-password${window.location.search}${window.location.hash}`, { replace: true });
          return;
        }
        // The Supabase client processes OAuth/PKCE and email tokens on initialization.
        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled) return;
        
        if (error || !session) {
          console.error('Verification error:', error);
          setErrorMessage(error?.message || 'The verification link may be expired or invalid. Sign in or request a new verification email.');
          setStatus('error');
          return;
        }

        setStatus('success');
        
        // Write to database to notify other devices
        try {
          await supabase.from('verification_events').insert({
            user_id: session.user.id,
            email: session.user.email,
          });
        } catch (dbError) {
          console.error('Failed to trigger verification event:', dbError);
        }
        
      } catch (err) {
        if (cancelled) return;
        console.error('Confirmation error:', err);
        setErrorMessage(err?.message || 'Unable to verify your email. Please try signing in again.');
        setStatus('error');
      }
    };

    handleEmailConfirmation();
    return () => { cancelled = true; };
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-blue-50 to-purple-50 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-lg border border-slate-200 text-center">
        {status === 'verifying' && (
          <>
            <div className="relative mx-auto mb-6 h-20 w-20">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  borderWidth: 4,
                  borderStyle: 'solid',
                  borderColor: 'rgba(148,163,184,0.45)',
                  borderTopColor: 'rgba(59,130,246,0.85)',
                  animation: 'spin 0.9s linear infinite',
                }}
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Verifying your email...</h1>
            <p className="text-slate-600">Please wait a moment</p>
            <style>{`
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div className="mx-auto mb-6 w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-4">Email Verified!</h1>
            <p className="text-slate-600 mb-6">
              Your account has been successfully verified.
            </p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <p className="text-blue-800 font-medium mb-2">
                You're all set!
              </p>
              <p className="text-sm text-blue-700">
                Continue here, or return to your original tab to finish signing in.
              </p>
            </div>
            <button
              onClick={() => navigate(returnTo, { replace: true })}
              className="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Continue to Retaliate AI
            </button>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div className="mx-auto mb-6 w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
              <X className="w-12 h-12 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">Verification Failed</h1>
            <p className="text-slate-600 mb-6">
              {errorMessage}
            </p>
            <button
              onClick={() => navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true })}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}