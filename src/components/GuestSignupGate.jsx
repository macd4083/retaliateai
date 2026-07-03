import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { trackEvent } from '../lib/analytics';
import { buildSignupPath } from '../lib/guestSession';

/**
 * GuestSignupGate
 *
 * Props:
 *   attribution – UTM/src object read from guestSession for event attribution
 *   mode – "fullscreen" (default) or "modal"
 *   context – analytics context label
 *   title/body/ctaLabel – optional copy overrides
 *   onSecondaryAction – optional callback for low-emphasis secondary action
 *   secondaryLabel – optional secondary CTA label
 */
export default function GuestSignupGate({
  attribution = {},
  mode = 'fullscreen',
  context = 'guest_gate',
  title = 'Save your commitment for tomorrow',
  body = 'To stay accountable and come back to your commitment tomorrow, create your account to save this session.',
  ctaLabel = 'Create account',
  onSecondaryAction = null,
  secondaryLabel = 'Not now',
}) {
  const navigate = useNavigate();
  const ctaRef = useRef(null);
  const isModal = mode === 'modal';
  const shownEvent = isModal
    ? 'guest_commitment_signup_modal_shown'
    : 'guest_second_session_blocked_signup_required';
  const ctaEvent = isModal
    ? 'guest_commitment_signup_modal_cta_clicked'
    : 'guest_gate_signup_clicked';
  const secondaryEvent = isModal
    ? 'guest_commitment_signup_modal_secondary_clicked'
    : 'guest_gate_login_clicked';

  // Fire once on mount
  useEffect(() => {
    trackEvent(shownEvent, { ...attribution, context });
    if (isModal) ctaRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignUp = () => {
    trackEvent(ctaEvent, { ...attribution, context });
    navigate(buildSignupPath(attribution));
  };

  const handleSecondary = () => {
    trackEvent(secondaryEvent, { ...attribution, context });
    if (typeof onSecondaryAction === 'function') {
      onSecondaryAction();
      return;
    }
    navigate('/login');
  };

  return (
    <div
      className={`${isModal
        ? 'fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 sm:p-6'
        : 'flex flex-col items-center justify-center h-screen bg-zinc-950 text-white px-6'
      }`}
      role={isModal ? 'presentation' : undefined}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className={`${isModal
          ? 'w-full max-w-md text-left bg-zinc-900 border border-zinc-700 rounded-2xl p-5 sm:p-6 shadow-2xl'
          : 'w-full max-w-sm text-center'
        }`}
        role={isModal ? 'dialog' : undefined}
        aria-modal={isModal ? 'true' : undefined}
        aria-labelledby={isModal ? 'guest-signup-gate-title' : undefined}
        aria-describedby={isModal ? 'guest-signup-gate-body' : undefined}
      >
        <p className={`${isModal ? 'text-2xl mb-3' : 'text-4xl mb-4'}`}>🌙</p>
        <h2
          id={isModal ? 'guest-signup-gate-title' : undefined}
          className={`${isModal ? 'text-xl sm:text-2xl font-semibold mb-2 text-white' : 'text-xl font-bold mb-4 text-center text-white'}`}
        >
          {title}
        </h2>
        <p
          id={isModal ? 'guest-signup-gate-body' : undefined}
          className={`${isModal ? 'text-zinc-300 text-sm sm:text-base leading-relaxed mb-6' : 'text-zinc-400 text-sm leading-relaxed mb-8 text-center'}`}
        >
          {body}
        </p>

        <div className={`${isModal ? 'flex flex-col-reverse sm:flex-row gap-3' : 'flex flex-col items-center gap-4'}`}>
          <button
            ref={ctaRef}
            onClick={handleSignUp}
            className={`${isModal
              ? 'w-full sm:flex-1 px-5 py-3 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900'
              : 'px-8 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-full transition-colors'
            }`}
          >
            {ctaLabel}
          </button>

          <button
            onClick={handleSecondary}
            className={`${isModal
              ? 'w-full sm:w-auto px-5 py-3 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-600 rounded-xl hover:bg-zinc-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900'
              : 'text-sm font-medium text-red-400 hover:text-red-300 transition-colors'
            }`}
          >
            {secondaryLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
