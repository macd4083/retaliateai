import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const { posthogMock, supabaseMock } = vi.hoisted(() => ({
  posthogMock: {
    __loaded: false,
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
  supabaseMock: {
    auth: {
      getSession: vi.fn(),
      signInAnonymously: vi.fn(),
    },
    from: vi.fn(),
  },
}));

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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @typedef {Window & { fbq?: (...args: any[]) => void }} TestWindow
 */

async function waitForCondition(condition, description = 'condition', timeout = 2000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (condition()) return;
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error(`Timed out after ${timeout}ms waiting for ${description}`);
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
  let updateEqMock;        // eq used in the update chain (profile write)
  let selectEqMock;  // eq used in the select chain (gate check)
  let maybeSingleMock;
  let selectMock;
  /** @type {TestWindow} */
  const testWindow = window;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();

    testWindow.fbq = undefined;

    posthogMock.__loaded = false;
    posthogMock.init = vi.fn();
    posthogMock.capture = vi.fn();
    posthogMock.identify = vi.fn();
    posthogMock.opt_out_capturing = vi.fn();

    // Gate-check chain: select('requires_signup_for_next_session').eq(...).maybeSingle()
    // Default: not a returning guest (flag is false → proceed to reflection).
    maybeSingleMock = vi.fn().mockResolvedValue({ data: { requires_signup_for_next_session: false }, error: null });
    selectEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });

    // Profile-update chain: update({...}).eq(...)
    updateEqMock = vi.fn().mockResolvedValue({ error: null });
    updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });

    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabaseMock.auth.signInAnonymously.mockResolvedValue({
      data: { user: { id: 'guest-user-1' } },
      error: null,
    });
    supabaseMock.from.mockReturnValue({
      select: selectMock,
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

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'guest success redirect');

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
        updated_at: expect.any(String),
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith('id', 'guest-user-1');
  });

  it('falls back to minimal profile update when optional guest columns are missing', async () => {
    updateEqMock
      .mockResolvedValueOnce({
        error: {
          code: 'PGRST204',
          message: "Could not find the 'is_guest_campaign_user' column of 'user_profiles' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'guest redirect');

    expect(updateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        is_guest_campaign_user: true,
      })
    );
    expect(updateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        updated_at: expect.any(String),
      })
    );
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateEqMock).toHaveBeenCalledTimes(2);
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

    await waitForCondition(
      () => view.container.textContent.includes(GUEST_MODE_UNAVAILABLE_MESSAGE),
      'guest fallback message'
    );
    expect(view.container.textContent).toContain('Continue with Free Trial');

    await act(async () => {
      vi.advanceTimersByTime(GUEST_FALLBACK_REDIRECT_DELAY_MS);
    });

    await waitForCondition(() => view.router.state.location.pathname === '/login', 'guest fallback redirect');

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

    testWindow.fbq = vi.fn(() => {
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

    await waitForCondition(() => view.router.state.location.pathname === '/login', 'login route');
    await waitForCondition(() => view.container.textContent.includes('Create your account'), 'login render');

    expect(testWindow.fbq).toHaveBeenCalledWith('track', 'Lead');
    expect(view.container.textContent).toContain('Create your account');
    expect(view.container.querySelector('input[type="email"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Sign Up');
  });

  it('redirects returning guest to signup when requires_signup_for_next_session is true', async () => {
    // Simulate a returning guest whose first session is already complete.
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'returning-guest-1' } } },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: { requires_signup_for_next_session: true },
      error: null,
    });

    view = await renderRouter('/start/guest?src=instagram&utm_source=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/login', element: <div>Signup Page</div> },
      { path: '/reflection', element: <div>Reflection</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/login', 'returning guest signup redirect');

    const params = new URLSearchParams(view.router.state.location.search);
    expect(params.get('signup')).toBe('true');
    expect(params.get('src')).toBe('instagram');
    // Should NOT have started a new profile update (gate fired before the write)
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('continues to reflection when gate check returns missing column error', async () => {
    // If the column is not yet in the DB, the gate check fails gracefully and lets the
    // user proceed rather than crashing or showing a misleading signup prompt.
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST204', message: "Could not find the 'requires_signup_for_next_session' column" },
    });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'fallback redirect');
    expect(updateMock).toHaveBeenCalled();
  });
});
