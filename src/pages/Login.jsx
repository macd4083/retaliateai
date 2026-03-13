import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, ArrowLeft, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (searchParams.get('signup') === 'true') {
      setIsSignUp(true);
    }
  }, [searchParams]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      setMessageType('error');
    } else {
      setMessage('Login successful!');
      setMessageType('success');
      setTimeout(() => navigate('/Journal'), 1000);
    }
    setLoading(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      }
    });

    if (error) {
      if (error.message.includes('already registered') || error.message.includes('already exists') || error.status === 422) {
        setMessage('');
        setMessageType('info');
        setIsSignUp(false);
        setTimeout(() => {
          setMessage('We found an existing account with this email. Please sign in below.');
          setMessageType('info');
        }, 100);
      } else {
        setMessage(error.message);
        setMessageType('error');
      }
      setLoading(false);
    } else {
      setSignupEmail(email);
      setSignupPassword(password);
      setShowOtpInput(true);
      setMessage('Check your email! Click the verification link or enter the code.');
      setMessageType('success');
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) {
      setMessage(error.message);
      setMessageType('error');
    } else {
      setMessage('Password reset link sent! Check your email.');
      setMessageType('success');
    }
    setLoading(false);
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setMessage('');
    setMessageType('');
    setShowPassword(false);
    setShowOtpInput(false);
    setSignupEmail('');
    setSignupPassword('');
  };

  if (showOtpInput) {
    return (
      <VerificationWaitingScreen 
        signupEmail={signupEmail} 
        signupPassword={signupPassword}
        onBack={() => { setShowOtpInput(false); resetForm(); }} 
        navigate={navigate} 
      />
    );
  }

  if (isForgotPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 px-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-lg border border-slate-200">
          <button
            onClick={() => {
              setIsForgotPassword(false);
              resetForm();
            }}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </button>

          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Reset Password</h1>
            <p className="text-slate-600">Enter your email to receive a reset link</p>
          </div>

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {message && (
              <div className={`p-3 rounded-lg text-sm ${
                messageType === 'success' 
                  ? 'bg-green-50 text-green-700 border border-green-200' 
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-lg border border-slate-200">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img src="/inverselogo.png" alt="Retaliate AI" className="w-12 h-12" />
            <h1 className="text-2xl font-bold text-slate-900">Retaliate AI</h1>
          </div>
          <p className="text-slate-600">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </p>
        </div>

        <form onSubmit={isSignUp ? handleSignup : handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={loading}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-12 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={loading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {!isSignUp && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => setIsForgotPassword(true)}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Forgot password?
              </button>
            </div>
          )}

          {message && (
            <div className={`p-3 rounded-lg text-sm ${
              messageType === 'success' 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : messageType === 'info'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {loading ? (isSignUp ? 'Creating account...' : 'Signing in...') : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              resetForm();
            }}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 mx-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}

function VerificationWaitingScreen({ signupEmail, signupPassword, onBack, navigate }) {
  const [dots, setDots] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpMessage, setOtpMessage] = useState('');
  const [otpMessageType, setOtpMessageType] = useState('');

  useEffect(() => {
    const dotsInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    // Poll database for verification event every 2 seconds
    const checkInterval = setInterval(async () => {
      try {
        const { data: events } = await supabase
          .from('verification_events')
          .select('*')
          .eq('email', signupEmail)
          .order('created_at', { ascending: false })
          .limit(1);

        if (events && events.length > 0) {
          // Event exists, user is verified! Sign them in
          const { data: signInData } = await supabase.auth.signInWithPassword({
            email: signupEmail,
            password: signupPassword,
          });

          if (signInData?.session) {
            clearInterval(checkInterval);
            clearInterval(dotsInterval);
            navigate('/Journal');
          }
        }
      } catch (err) {
        console.error('Check failed:', err);
      }
    }, 2000);

    return () => {
      clearInterval(dotsInterval);
      clearInterval(checkInterval);
    };
  }, [signupEmail, signupPassword, navigate]);

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setOtpLoading(true);
    setOtpMessage('');

    const { data, error } = await supabase.auth.verifyOtp({
      email: signupEmail,
      token: otp,
      type: 'signup'
    });

    if (error) {
      setOtpMessage(error.message);
      setOtpMessageType('error');
      setOtpLoading(false);
    } else {
      // Verification successful! Write to database to notify other devices
      try {
        await supabase.from('verification_events').insert({
          user_id: data.user.id,
          email: signupEmail,
        });
      } catch (dbError) {
        console.error('Failed to write verification event:', dbError);
      }
      
      setOtpMessage('Email verified! Redirecting...');
      setOtpMessageType('success');
      setTimeout(() => navigate('/Journal'), 1500);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-lg border border-slate-200">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign up
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h1>
          <p className="text-slate-600 mb-4">
            We sent a verification email to <strong>{signupEmail}</strong>
          </p>
          <p className="text-sm text-slate-500 mb-2">
            Click the link in your email or enter the 8-digit code below.
          </p>
          <p className="text-sm text-green-600 font-medium">
            Waiting for verification{dots}
          </p>
        </div>

        <form onSubmit={handleVerifyOtp} className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 text-center">
              Or enter verification code
            </label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="00000000"
              maxLength={8}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-center text-2xl tracking-widest font-mono"
              disabled={otpLoading}
            />
          </div>

          {otpMessage && (
            <div className={`p-3 rounded-lg text-sm ${
              otpMessageType === 'success' 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {otpMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={otpLoading || otp.length !== 8}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {otpLoading ? 'Verifying...' : 'Verify Code'}
          </button>
        </form>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800 font-semibold mb-2">Can't find the email?</p>
          <ul className="text-sm text-blue-700 space-y-1 ml-4 list-disc">
            <li>Check your spam/junk folder</li>
            <li>Wait a few minutes - emails can be delayed</li>
            <li>Click the link on ANY device (phone, tablet, etc.)</li>
            <li>This page detects verification automatically</li>
          </ul>
        </div>

        <div className="relative mx-auto mt-6 h-12 w-12">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              borderWidth: 3,
              borderStyle: 'solid',
              borderColor: 'rgba(148,163,184,0.3)',
              borderTopColor: 'rgba(59,130,246,0.8)',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}