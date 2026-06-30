import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { trackEvent } from '../lib/analytics';
import { buildSignupPath } from '../lib/guestSession';

/**
 * GuestSignupGate
 *
 * Shown when a guest user's access window has expired and they need to
 * create an account before continuing.
 *
 * Props:
 *   attribution – UTM/src object read from guestSession for event attribution
 */
export default function GuestSignupGate({ attribution = {} }) {
  const navigate = useNavigate();

  // Fire once on mount
  useEffect(() => {
    trackEvent('guest_second_session_blocked_signup_required', attribution);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignUp = () => {
    trackEvent('guest_gate_signup_clicked', { ...attribution, context: 'guest_gate' });
    navigate(buildSignupPath(attribution));
  };

  const handleLogIn = () => {
    trackEvent('guest_gate_login_clicked', { ...attribution, context: 'guest_gate' });
    navigate('/login');
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm text-center"
      >
        <p className="text-4xl mb-4">🔒</p>
        <h2 className="text-xl font-bold mb-4">You need to create an account before continuing.</h2>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          Your guest access window has ended. Create a free account to keep
          your momentum going and unlock daily reflection.
        </p>

        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleSignUp}
            className="px-8 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-full transition-colors"
          >
            Sign Up
          </button>

          <button
            onClick={handleLogIn}
            className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            Log in
          </button>
        </div>
      </motion.div>
    </div>
  );
}
