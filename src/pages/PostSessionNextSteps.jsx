import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Smartphone } from 'lucide-react';
import { trackEvent } from '../lib/analytics';
import { buildSignupPath, readAttribution } from '../lib/guestSession';
import { usePWAInstall } from '../hooks/usePWAInstall';
import ReflectionSummaryCard from '../components/v2/ReflectionSummaryCard';

/**
 * PostSessionNextSteps  –  route: /post-session/next-steps
 *
 * Post-first-session conversion page for guest campaign users.
 * Shows the reflection summary (via shared component) and prompts:
 *   1. Start Free Trial  (primary CTA)
 *   2. Install the web app  (secondary CTA)
 *
 * Receives session summary via React Router navigation state:
 *   { summaryCardData, streak, followThroughStats }
 */
export default function PostSessionNextSteps() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const attribution = readAttribution();
  const { isInstallable, isIos, isStandalone, promptInstall } = usePWAInstall();
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  const summaryCardData = state?.summaryCardData || {};
  const streak = state?.streak || 0;
  const followThroughStats = state?.followThroughStats || null;

  // Fire view event once on mount.
  // attribution is derived from readAttribution() which reads sessionStorage on render;
  // it will not change between renders, so excluding it from deps is intentional.
  useEffect(() => {
    trackEvent('post_session_cta_viewed', attribution);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartTrial = () => {
    trackEvent('post_session_start_trial_clicked', attribution);
    navigate(buildSignupPath(attribution));
  };

  const handleDownloadApp = async () => {
    trackEvent('post_session_download_app_clicked', attribution);
    if (isInstallable && !isIos) {
      await promptInstall();
    } else {
      setShowInstallHelp(true);
    }
  };

  const hasSummaryData = Object.keys(summaryCardData).some((k) => summaryCardData[k]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-start px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-4xl mb-3">🌙</p>
          <h1 className="text-2xl font-bold text-white mb-2">
            Nice work tonight.
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            You just showed up for yourself. Keep that momentum going.
          </p>
        </div>

        {/* Reflection summary — shared component, zero duplication */}
        {hasSummaryData && (
          <div className="mb-8">
            <ReflectionSummaryCard
              data={summaryCardData}
              streak={streak}
              followThroughStats={followThroughStats}
              showInsightsLink={false}
            />
          </div>
        )}

        {/* Conversion CTAs */}
        <div className="space-y-3">
          <button
            onClick={handleStartTrial}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold py-4 rounded-2xl transition-colors text-base"
          >
            Start Free Trial
            <ArrowRight className="w-5 h-5" />
          </button>

          {!isStandalone && <button
            onClick={handleDownloadApp}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white font-medium py-4 rounded-2xl border border-zinc-700 hover:border-zinc-600 transition-colors text-base"
          >
            <Smartphone className="w-5 h-5 text-zinc-400" />
            Install web app
          </button>}
          {showInstallHelp && (
            <p className="text-zinc-400 text-sm leading-relaxed">
              {isIos
                ? 'In Safari, tap Share, then Add to Home Screen.'
                : 'In a supported browser, use the menu or address-bar install option when available.'}
              {' '}Internet is required to save reviews and load data.
            </p>
          )}
          <p className="text-zinc-500 text-xs text-center">
            Installing is optional and does not start a subscription.
          </p>

          {/* Low-emphasis dismiss */}
          <button
            onClick={() => navigate('/')}
            className="w-full text-zinc-600 hover:text-zinc-400 text-sm py-2 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </motion.div>
    </div>
  );
}
