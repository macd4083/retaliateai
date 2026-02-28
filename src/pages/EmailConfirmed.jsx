import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';

export default function EmailConfirmed() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleEmailConfirmation = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (session) {
        // Verified! Redirect to app
        navigate('/Journal', { replace: true });
      } else {
        // Something went wrong
        navigate('/login', { replace: true });
      }
    };

    setTimeout(handleEmailConfirmation, 500);
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-blue-50 to-purple-50">
      <div className="text-center">
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
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Verifying...</h1>
        <p className="text-slate-600">Redirecting you to your journal</p>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}