import { useState, useEffect } from 'react';

function getIsIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function getIsStandalone() {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if ('standalone' in window.navigator && window.navigator.standalone === true) return true;
  if (document.referrer.startsWith('android-app://')) return true;
  return false;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone] = useState(() => getIsStandalone());
  const [isIos] = useState(() => getIsIos());
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    if (isStandalone) return;

    if (isIos) {
      setIsInstallable(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isStandalone, isIos]);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
    return outcome === 'accepted';
  };

  return { isInstallable, isIos, isStandalone, promptInstall };
}
