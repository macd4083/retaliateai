import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePWAInstall } from '../hooks/usePWAInstall';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PWA installation preserves work', () => {
  let root;
  let container;
  let state;

  function Harness() {
    state = usePWAInstall();
    return <div>{state.isInstallable ? 'Install available' : 'Use browser'}</div>;
  }

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome desktop');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['accepted', 'dismissed'])('consumes the single-use prompt after %s without navigation', async (outcome) => {
    const prompt = vi.fn();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
    const location = window.location.href;
    await act(async () => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(state.isInstallable).toBe(true);
    let result;
    await act(async () => { result = await state.promptInstall(); });
    expect(result).toBe(outcome === 'accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(state.isInstallable).toBe(false);
    await expect(state.promptInstall()).resolves.toBe(false);
    expect(window.location.href).toBe(location);
  });

  it('clears installation availability when the browser reports appinstalled', async () => {
    await act(async () => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
    expect(state.isInstallable).toBe(true);
    await act(async () => window.dispatchEvent(new Event('appinstalled')));
    expect(state.isInstallable).toBe(false);
  });
});
