import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sw = vi.hoisted(() => ({
  waiting: false,
  update: vi.fn(),
  options: null,
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options) => {
    sw.options = options;
    return { needRefresh: [sw.waiting], updateServiceWorker: sw.update };
  },
}));
import PWAUpdatePrompt from '../components/pwa/PWAUpdatePrompt';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PWA update prompt', () => {
  let root;
  let container;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  async function render(waiting) {
    sw.waiting = waiting;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<PWAUpdatePrompt />));
  }

  it('does not reload without consent and activates the waiting worker on reload', async () => {
    await render(true);
    expect(container.textContent).toContain('New version available — reload');
    expect(sw.update).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button').click());
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('hides when there is no waiting update', async () => {
    await render(false);
    expect(container.textContent).toBe('');
  });

  it('checks for updates on focus and cleans up the listener', async () => {
    await render(false);
    const update = vi.fn().mockResolvedValue(undefined);
    sw.options.onRegisteredSW('/sw.js', { update });
    window.dispatchEvent(new Event('focus'));
    expect(update).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = null;
    window.dispatchEvent(new Event('focus'));
    expect(update).toHaveBeenCalledOnce();
  });

  it('offers retry when activating an update fails', async () => {
    sw.update.mockRejectedValueOnce(new Error('offline'));
    await render(true);
    await act(async () => container.querySelector('button').click());
    expect(container.textContent).toContain('Update failed');
    expect(container.querySelector('button').disabled).toBe(false);
  });
});
