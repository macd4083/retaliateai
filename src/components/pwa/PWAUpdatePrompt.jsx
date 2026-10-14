import React, { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PWAUpdatePrompt() {
  const registrationRef = useRef(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
    },
    onRegisterError(error) {
      console.error('[Service worker registration]', error);
    },
  });

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      registrationRef.current?.update().catch((error) => {
        console.warn('[Service worker update check]', error);
      });
    };
    const interval = window.setInterval(check, 60 * 60 * 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const reload = async () => {
    setUpdating(true);
    setError('');
    try {
      await updateServiceWorker(true);
    } catch {
      setError('Update failed. Please try again.');
      setUpdating(false);
    }
  };

  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl border border-zinc-600 bg-zinc-900 p-4 text-sm text-white shadow-xl">
      <p>New version available — reload</p>
      <p className="mt-1 text-xs text-zinc-400">Save your work before reloading.</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={reload} disabled={updating} className="mt-2 rounded bg-red-600 px-3 py-2 disabled:opacity-50">
        {updating ? 'Reloading…' : 'Reload'}
      </button>
    </div>
  );
}
