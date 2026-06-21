import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const posthogMock = {
  __loaded: false,
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  opt_out_capturing: vi.fn(),
};

const supabaseMock = {
  auth: {
    getSession: vi.fn(),
    signInAnonymously: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock('posthog-js', () => ({
  default: posthogMock,
}));

vi.mock('../lib/supabase/client', () => ({
  supabase: supabaseMock,
}));

import Login from '../pages/Login';
import GuestEntry from '../pages/GuestEntry';
import {
  buildSignupPath,
  extractAttribution,
  GUEST_FALLBACK_REDIRECT_DELAY_MS,
  GUEST_MODE_UNAVAILABLE_MESSAGE,
  readAttribution,
  saveAttribution,
} from '../lib/guestSession';

async function waitForCondition(condition, timeout = 2000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (condition()) return;
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error('Timed out waiting for condition');
}

async function renderRouter(initialEntry, routes) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });

  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });

  return { container, root, router };
}

describe('guest campaign onboarding', () => {
  let view;
  let updateMock;
  let eqMock;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();

    delete window.fbq;

    posthogMock.__loaded = false;
    posthogMock.init = vi.fn();
    posthogMock.capture = vi.fn();
    posthogMock.identify = vi.fn();
    posthogMock.opt_out_capturing = vi.fn();

    eqMock = vi.fn().mockResolvedValue({ error: null });
    updateMock = vi.fn(() => ({ eq: eqMock }));

    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabaseMock.auth.signInAnonymously.mockResolvedValue({
      data: { user: { id: 'guest-user-1' } },
      error: null,
    });
    supabaseMock.from.mockReturnValue({
      update: updateMock,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();

    if (view) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
      view = null;
    }
  });

  it('extracts attribution defensively and preserves it in signup redirects', () => {
    expect(extractAttribution()).toEqual({});
    expect(
      buildSignupPath(
        { src: 'instagram', utm_source: 'instagram', utm_campaign: 'guest_launch' },
        { guest: 'unavailable' }
      )
    ).toBe(
      '/login?signup=true&guest=unavailable&src=instagram&utm_source=instagram&utm_campaign=guest_launch'
    );
  });

  it('persists attribution through session storage', () => {
    saveAttribution({ src: 'instagram', utm_source: 'instagram', invalid: 'ignored' });
    expect(readAttribution()).toEqual({
      src: 'instagram',
      utm_source: 'instagram',
    });
  });

  it('routes through the normal guest flow when anonymous auth is enabled', async () => {
    view = await renderRouter('/start/guest?src=instagram&utm_source=instagram&utm_campaign=trial', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection');

    expect(readAttribution()).toEqual({
      src: 'instagram',
      utm_source: 'instagram',
      utm_campaign: 'trial',
    });
    expect(supabaseMock.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith('user_profiles');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_guest_campaign_user: true,
        campaign_attribution: expect.objectContaining({
          src: 'instagram',
          utm_source: 'instagram',
          utm_campaign: 'trial',
        }),
      })
    );
    expect(eqMock).toHaveBeenCalledWith('id', 'guest-user-1');
  });

  it('falls back to signup without crashing when anonymous auth is disabled', async () => {
    vi.useFakeTimers();
    supabaseMock.auth.signInAnonymously.mockResolvedValue({
      data: { user: null },
      error: {
        message: 'Anonymous sign-ins are disabled',
        status: 422,
      },
    });

    view = await renderRouter('/start/guest?src=instagram&utm_source=instagram&utm_campaign=guest_launch', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/login', element: <div>Signup Route</div> },
    ]);

    await waitForCondition(() => view.container.textContent.includes(GUEST_MODE_UNAVAILABLE_MESSAGE));
    expect(view.container.textContent).toContain('Continue with Free Trial');

    await act(async () => {
      vi.advanceTimersByTime(GUEST_FALLBACK_REDIRECT_DELAY_MS);
    });

    await waitForCondition(() => view.router.state.location.pathname === '/login');

    const params = new URLSearchParams(view.router.state.location.search);
    expect(params.get('signup')).toBe('true');
    expect(params.get('guest')).toBe('unavailable');
    expect(params.get('src')).toBe('instagram');
    expect(params.get('utm_source')).toBe('instagram');
    expect(params.get('utm_campaign')).toBe('guest_launch');
  });

  it('still renders the signup route when analytics providers are blocked', async () => {
    vi.useFakeTimers();

    posthogMock.__loaded = true;
    posthogMock.capture.mockImplementation(() => {
      throw new Error('ERR_BLOCKED_BY_CLIENT');
    });
    posthogMock.identify.mockImplementation(() => {
      throw new Error('ERR_BLOCKED_BY_CLIENT');
    });

    window.fbq = vi.fn(() => {
      throw new Error('ERR_BLOCKED_BY_CLIENT');
    });

    supabaseMock.auth.signInAnonymously.mockResolvedValue({
      data: { user: null },
      error: {
        message: 'Anonymous sign-ins are disabled',
        status: 422,
      },
    });

    view = await renderRouter('/start/guest?src=instagram&utm_source=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/login', element: <Login /> },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(GUEST_FALLBACK_REDIRECT_DELAY_MS);
    });

    await waitForCondition(() => view.router.state.location.pathname === '/login');
    await waitForCondition(() => view.container.textContent.includes('Create your account'));

    expect(window.fbq).toHaveBeenCalledWith('track', 'Lead');
    expect(view.container.textContent).toContain('Create your account');
  });
});
