export const BROWSER_STORAGE_STATUS_EVENT = 'browser-storage-status-changed';

let status = Object.freeze({ unavailable: false });

function reportUnavailable() {
  if (status.unavailable) return;
  status = Object.freeze({ unavailable: true });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BROWSER_STORAGE_STATUS_EVENT));
  }
}

export function getBrowserStorageStatus() {
  return status;
}

function accessStorage(storageName, operation, fallback) {
  try {
    if (typeof window === 'undefined' || !window[storageName]) {
      reportUnavailable();
      return fallback;
    }
    return operation(window[storageName]);
  } catch {
    reportUnavailable();
    return fallback;
  }
}

export function safeGetStorageItem(key, storageName = 'localStorage') {
  return accessStorage(storageName, (storage) => storage.getItem(key), null);
}

export function safeSetStorageItem(key, value, storageName = 'localStorage') {
  return accessStorage(storageName, (storage) => {
    storage.setItem(key, value);
    return true;
  }, false);
}

export function safeRemoveStorageItem(key, storageName = 'localStorage') {
  return accessStorage(storageName, (storage) => {
    storage.removeItem(key);
    return true;
  }, false);
}

// Auth fallback lives only in this adapter's memory, never in another disk store.
export function createBrowserStorageAdapter({ storageName = 'localStorage', memoryFallback = true } = {}) {
  const memory = new Map();
  let diskUnavailable = false;
  return {
    getItem(key) {
      if (memoryFallback && diskUnavailable) return memory.get(key) ?? null;
      const value = accessStorage(storageName, (storage) => storage.getItem(key), undefined);
      if (value === undefined) {
        diskUnavailable = true;
        return memoryFallback ? memory.get(key) ?? null : null;
      }
      if (memoryFallback) memory.set(key, value);
      return value ?? null;
    },
    setItem(key, value) {
      if (memoryFallback) memory.set(key, String(value));
      if (memoryFallback && diskUnavailable) return;
      if (!safeSetStorageItem(key, value, storageName)) diskUnavailable = true;
    },
    removeItem(key) {
      // A tombstone prevents a failed removal from reviving an old disk session.
      if (memoryFallback) memory.set(key, null);
      if (!safeRemoveStorageItem(key, storageName)) diskUnavailable = true;
    },
  };
}
