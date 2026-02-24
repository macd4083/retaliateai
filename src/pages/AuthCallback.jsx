import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase automatically handles the token from URL
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Auth error:', error);
          setStatus('error');
          return;
        }

        if (data.session) {
          setStatus('success');
          // Broadcast to other tabs that user is now signed in
          localStorage.setItem('supabase.auth.token', JSON.stringify(data.session));
          window.dispatchEvent(new Event('storage'));
          
          setTimeout(() => navigate('/Journal'), 2000);
        } else {
          setStatus('error');
        }
      } catch (err) {
        console.error('Callback error:', err);
        setStatus('error');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-red-50">
      <div className="text-center">
        {status === 'verifying' && (
          <>
            <div className="relative mx-auto mb-6 h-20 w-20">
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
            <p className="text-slate-700 font-medium">Verifying your email...</p>
            <style>{`
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div className="text-green-600 text-5xl mb-4">✓</div>
            <p className="text-slate-900 font-semibold mb-2">Email confirmed!</p>
            <p className="text-slate-600">Redirecting to your journal...</p>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div className="text-red-600 text-5xl mb-4">✗</div>
            <p className="text-slate-900 font-semibold mb-2">Verification failed</p>
            <p className="text-slate-600 mb-4">The link may be expired or invalid.</p>
            <button
              onClick={() => navigate('/login')}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}