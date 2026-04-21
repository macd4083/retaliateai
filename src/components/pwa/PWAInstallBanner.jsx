import React, { useState, useEffect } from 'react';
import { Download, Share } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

const MAX_SHOW_COUNT = 3;
const STORAGE_KEY_COUNT = 'pwa_prompt_count';
const STORAGE_KEY_DISMISSED = 'pwa_prompt_dismissed';

export default function PWAInstallBanner() {
  const { isInstallable, isIos, isStandalone, promptInstall } = usePWAInstall();
  const [visible, setVisible] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (isStandalone) return;
    if (!isInstallable) return;
    if (localStorage.getItem(STORAGE_KEY_DISMISSED) === 'true') return;

    const current = parseInt(localStorage.getItem(STORAGE_KEY_COUNT) || '0', 10);
    if (current >= MAX_SHOW_COUNT) return;
    localStorage.setItem(STORAGE_KEY_COUNT, String(current + 1));
    setVisible(true);
  }, [isInstallable, isStandalone]);

  const handleInstall = async () => {
    if (isIos) return;
    const accepted = await promptInstall();
    if (accepted) setVisible(false);
  };

  const handleDecline = () => {
    setDeclined(true);
  };

  const handleOkay = () => {
    localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="w-full bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-start gap-3 relative">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-600 rounded-r" />

      <div className="flex-1 min-w-0">
        {!declined ? (
          <>
            <p className="text-white text-sm font-semibold leading-snug">Get the full app experience</p>
            <p className="text-zinc-400 text-xs mt-0.5 leading-relaxed">
              {isIos ? (
                <>
                  Tap <Share className="inline w-3 h-3" /> then{' '}
                  <strong className="text-zinc-300">"Add to Home Screen"</strong> to install Retaliate AI.
                </>
              ) : (
                'Download Retaliate AI to your home screen — faster, offline-ready, and no browser chrome.'
              )}
            </p>
            <div className="flex items-center gap-3 mt-2.5">
              {!isIos && (
                <button
                  onClick={handleInstall}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Download App
                </button>
              )}
              <button
                onClick={handleDecline}
                className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
              >
                No thanks
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-zinc-300 text-sm leading-relaxed">
              If you ever change your mind, you can download the app with the{' '}
              <Download className="inline w-3.5 h-3.5 text-zinc-400" /> download button in the top right.
            </p>
            <button
              onClick={handleOkay}
              className="mt-2.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
            >
              Okay
            </button>
          </>
        )}
      </div>
    </div>
  );
}
