import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Smartphone } from 'lucide-react';
import { trackEvent } from '../lib/analytics';
import { buildSignupPath } from '../lib/guestSession';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * GuestSignupGate
 *
 * Shown when a guest campaign user (requires_signup_for_next_session=true) tries
 * to start a second session without creating an account.
 *
 * Props:
 *   attribution – UTM/src object read from guestSession for event attribution
 */
export default function GuestSignupGate({ attribution = {} }) {
  const navigate = useNavigate();
  const { isInstallable, isIos, promptInstall } = usePWAInstall();

  // Fire once on mount
  useEffect(() => {
    trackEvent('guest_second_session_blocked_signup_required', attribution);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartTrial = () => {
    trackEvent('post_session_start_trial_clicked', { ...attribution, context: 'second_session_gate' });
    navigate(buildSignupPath(attribution));
  };

  const handleDownloadApp = async () => {
    trackEvent('post_session_download_app_clicked', { ...attribution, context: 'second_session_gate' });
    if (isInstallable && !isIos) {
      await promptInstall();
    } else {
      navigate('/');
    }
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
        <h2 className="text-xl font-bold mb-2">Ready for your next session?</h2>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          You've completed your free first session. Create a free account to keep
          your momentum going and unlock daily reflection.
        </p>

        <div className="space-y-3">
          <button
            onClick={handleStartTrial}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold py-4 rounded-2xl transition-colors"
          >
            Start Free Trial
            <ArrowRight className="w-5 h-5" />
          </button>

          <button
            onClick={handleDownloadApp}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white font-medium py-4 rounded-2xl border border-zinc-700 hover:border-zinc-600 transition-colors"
          >
            <Smartphone className="w-5 h-5 text-zinc-400" />
            Download the App
          </button>
        </div>
      </motion.div>
    </div>
  );
}
