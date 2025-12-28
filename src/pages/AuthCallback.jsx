import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase automatically handles the token from URL
        const { data, error } = await supabase. auth.getSession();
        
        if (error) {
          console.error('Auth error:', error);
          setStatus('error');
          return;
        }

        if (data.session) {
          setStatus('success');
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        {status === 'verifying' && (
          <>
            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-600">Verifying your email...</p>
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
              onClick={() => navigate('/Login')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}