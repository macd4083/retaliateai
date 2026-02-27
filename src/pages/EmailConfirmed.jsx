import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { CheckCircle, X } from 'lucide-react';

export default function EmailConfirmed() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const handleEmailConfirmation = async () => {
      try {
        // Get the session from the URL hash
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Verification error:', error);
          setStatus('error');
          return;
        }

        if (data.session) {
          setStatus('success');
          
          // Start countdown
          const timer = setInterval(() => {
            setCountdown((prev) => {
              if (prev <= 1) {
                clearInterval(timer);
                window.close(); // Try to close the tab
                return 0;
              }
              return prev - 1;
            });
          }, 1000);

          return () => clearInterval(timer);
        } else {
          setStatus('error');
        }
      } catch (err) {
        console.error('Confirmation error:', err);
        setStatus('error');
      }
    };

    handleEmailConfirmation();
  }, []);

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
            <h1 className="text-2xl font-bold text-slate-900 mb-3">Email Verified!</h1>
            <p className="text-slate-600 mb-6">
              Your account has been successfully verified.
            </p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-800 mb-2">
                This tab will close automatically in <strong>{countdown}</strong> seconds
              </p>
              <p className="text-xs text-blue-600">
                Go back to your original tab to continue
              </p>
            </div>

            <button
              onClick={() => window.close()}
              className="w-full bg-slate-600 text-white py-3 rounded-lg hover:bg-slate-700 transition-colors font-medium flex items-center justify-center gap-2"
            >
              <X className="w-5 h-5" />
              Close This Tab
            </button>

            <button
              onClick={() => navigate('/Journal')}
              className="w-full mt-3 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Or Continue Here
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
              The verification link may be expired or invalid.
            </p>
            <button
              onClick={() => navigate('/login')}
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