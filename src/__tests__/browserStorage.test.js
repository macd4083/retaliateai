import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('browser storage resilience', () => {
  let storage;

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    storage = await import('../lib/browserStorage');
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps normal persistence and observes external session changes', () => {
    const adapter = storage.createBrowserStorageAdapter();
    adapter.setItem('session', 'first');
    expect(window.localStorage.getItem('session')).toBe('first');
    window.localStorage.setItem('session', 'second');
    expect(adapter.getItem('session')).toBe('second');
    adapter.removeItem('session');
    expect(adapter.getItem('session')).toBeNull();
    expect(storage.getBrowserStorageStatus().unavailable).toBe(false);
  });

  it('survives a SecurityError from the storage property and signals once without values', () => {
    const listener = vi.fn();
    window.addEventListener(storage.BROWSER_STORAGE_STATUS_EVENT, listener);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const adapter = storage.createBrowserStorageAdapter();
    expect(adapter.getItem('session')).toBeNull();
    expect(() => adapter.setItem('session', 'in-memory-session')).not.toThrow();
    expect(adapter.getItem('session')).toBe('in-memory-session');
    expect(() => adapter.removeItem('session')).not.toThrow();
    expect(adapter.getItem('session')).toBeNull();
    expect(storage.getBrowserStorageStatus().unavailable).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toBeUndefined();
    window.removeEventListener(storage.BROWSER_STORAGE_STATUS_EVENT, listener);
  });

  it('falls back on quota failure without using sessionStorage or reviving a stale disk session', () => {
    window.localStorage.setItem('session', 'old');
    const otherDiskWrite = vi.fn();
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({ setItem: otherDiskWrite });
    vi.spyOn(Object.getPrototypeOf(window.localStorage), 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const adapter = storage.createBrowserStorageAdapter();
    adapter.setItem('session', 'new');
    expect(adapter.getItem('session')).toBe('new');
    vi.spyOn(Object.getPrototypeOf(window.localStorage), 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    adapter.removeItem('session');
    expect(adapter.getItem('session')).toBeNull();
    expect(otherDiskWrite).not.toHaveBeenCalled();
  });

  it('reports disk-only draft writes as failed rather than storing a memory copy', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage), 'setItem').mockImplementation(() => { throw new Error('Full'); });
    expect(storage.safeSetStorageItem('draft', 'unsaved')).toBe(false);
    expect(storage.safeGetStorageItem('draft')).toBeNull();
    expect(storage.getBrowserStorageStatus().unavailable).toBe(true);
  });

  it('still attempts to remove the old disk session after a failed write', () => {
    window.localStorage.setItem('session', 'old');
    const prototype = Object.getPrototypeOf(window.localStorage);
    vi.spyOn(prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    const remove = vi.spyOn(prototype, 'removeItem');
    const adapter = storage.createBrowserStorageAdapter();
    adapter.setItem('session', 'new');
    adapter.removeItem('session');
    expect(remove).toHaveBeenCalledWith('session');
    expect(window.localStorage.getItem('session')).toBeNull();
    expect(adapter.getItem('session')).toBeNull();
  });

  it('handles failed reads and removals', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage), 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Object.getPrototypeOf(window.localStorage), 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(storage.safeGetStorageItem('override')).toBeNull();
    expect(storage.safeRemoveStorageItem('override')).toBe(false);
  });
});
