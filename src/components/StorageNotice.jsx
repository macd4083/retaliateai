import React, { useSyncExternalStore } from 'react';
import { BROWSER_STORAGE_STATUS_EVENT, getBrowserStorageStatus } from '../lib/browserStorage';

function subscribe(listener) {
  window.addEventListener(BROWSER_STORAGE_STATUS_EVENT, listener);
  return () => window.removeEventListener(BROWSER_STORAGE_STATUS_EVENT, listener);
}

export default function StorageNotice() {
  const { unavailable } = useSyncExternalStore(subscribe, getBrowserStorageStatus, getBrowserStorageStatus);
  if (!unavailable) return null;
  return (
    <div role="status" className="border-b border-amber-700 bg-amber-950 px-4 py-2 text-xs text-amber-100">
      Browser storage is unavailable. Signed-in database saves still work, but local drafts and sign-in persistence may not survive closing or reloading. Check your browser&apos;s privacy settings.
    </div>
  );
}
