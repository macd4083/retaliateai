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
      signOut: vi.fn(),
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
  evaluateGuestAccess,
  extractAttribution,
  fetchGuestGuardrailsEnabled,
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
  let updateEqMock;  // eq used in the update chain (profile write)
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
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });
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
    // First visit: profile update should mark guest campaign and usage count
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_guest_campaign_user: true,
        updated_at: expect.any(String),
        guest_usage_count: 1,
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith('id', 'guest-user-1');
  });

  it('falls back to minimal profile update when optional guest columns are missing', async () => {
    // First call (full update with guest fields) → PGRST204
    // Second call (fallback: just is_guest_campaign_user + updated_at) → succeeds
    updateEqMock
      .mockResolvedValueOnce({
        error: {
          code: 'PGRST204',
          message: "Could not find the 'guest_usage_count' column of 'user_profiles' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'guest redirect');

    // First call: full update including guest usage count
    expect(updateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        is_guest_campaign_user: true,
        guest_usage_count: 1,
      })
    );
    // Second call (fallback): just guest flag + updated_at
    expect(updateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        is_guest_campaign_user: true,
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

  it('shows signup gate for returning guest when requires_signup_for_next_session is true', async () => {
    // Simulate a returning guest whose first session is already complete.
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'returning-guest-1', is_anonymous: true } } },
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

    await waitForCondition(
      () => view.container.textContent.includes('Create your account to continue'),
      'returning guest signup gate'
    );

    const cta = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create account'
    );
    expect(cta).toBeTruthy();
    await act(async () => {
      cta.click();
    });

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

  // ── Guest access policy tests ──────────────────────────────────────────────

  describe('evaluateGuestAccess (unit)', () => {
    it('returns allow for null profile', () => {
      expect(evaluateGuestAccess(null)).toBe('allow');
    });

    it('returns allow for brand-new guest with no signup requirement', () => {
      expect(evaluateGuestAccess({ requires_signup_for_next_session: false })).toBe('allow');
    });

    it('returns require_signup when requires_signup_for_next_session is true', () => {
      expect(evaluateGuestAccess({ requires_signup_for_next_session: true })).toBe('require_signup');
    });

    it('returns allow when guardrails are disabled', () => {
      expect(
        evaluateGuestAccess(
          { requires_signup_for_next_session: true },
          { guardrailsEnabled: false }
        )
      ).toBe('allow');
    });

    it('ignores legacy timing fields and only uses requires_signup_for_next_session', () => {
      expect(
        evaluateGuestAccess({
          requires_signup_for_next_session: true,
          guest_started_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          guest_cooldown_until: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        })
      ).toBe('require_signup');
    });
  });

  describe('fetchGuestGuardrailsEnabled', () => {
    it('returns true when the config row is missing', async () => {
      maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
      await expect(fetchGuestGuardrailsEnabled(supabaseMock)).resolves.toBe(true);
    });

    it('returns false when the config row disables guardrails', async () => {
      maybeSingleMock.mockResolvedValueOnce({ data: { value: false }, error: null });
      await expect(fetchGuestGuardrailsEnabled(supabaseMock)).resolves.toBe(false);
    });

    it('returns true when the config query errors', async () => {
      maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
      await expect(fetchGuestGuardrailsEnabled(supabaseMock)).resolves.toBe(true);
    });
  });

  it('allows returning guest with legacy timing fields when signup is not required', async () => {
    const oneDayAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const sixDaysFromNow = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'returning-guest-window', is_anonymous: true } } },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: {
        requires_signup_for_next_session: false,
        guest_started_at: oneDayAgo,
        guest_cooldown_until: sixDaysFromNow,
        guest_usage_count: 1,
      },
      error: null,
    });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'returning guest redirect');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_guest_campaign_user: true,
        guest_usage_count: 2,
        updated_at: expect.any(String),
      })
    );
  });

  it('requires signup for returning guests when requires_signup_for_next_session is true', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'window-override-guest', is_anonymous: true } } },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: {
        requires_signup_for_next_session: true,
        guest_started_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        guest_cooldown_until: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        guest_usage_count: 1,
      },
      error: null,
    });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
      { path: '/login', element: <div>Signup Page</div> },
    ]);

    await waitForCondition(
      () => view.container.textContent.includes('Create your account to continue'),
      'signup required gate'
    );
    const cta = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create account'
    );
    expect(cta).toBeTruthy();
    await act(async () => {
      cta.click();
    });
    await waitForCondition(() => view.router.state.location.pathname === '/login', 'signup required redirect');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('sets usage count on first visit when profile has no usage history', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        requires_signup_for_next_session: false,
        guest_usage_count: null,
      },
      error: null,
    });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'first visit redirect');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_guest_campaign_user: true,
        guest_usage_count: 1,
      })
    );
  });

  it('replaces stale authenticated sessions with anonymous guest sessions', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'signed-user-1', is_anonymous: false } } },
      error: null,
    });
    supabaseMock.auth.signInAnonymously.mockResolvedValue({
      data: { user: { id: 'fresh-guest-1' } },
      error: null,
    });

    view = await renderRouter('/start/guest?src=instagram', [
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/reflection', element: <div>Reflection Ready</div> },
    ]);

    await waitForCondition(() => view.router.state.location.pathname === '/reflection', 'stale session guest redirect');

    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
    expect(supabaseMock.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(updateEqMock).toHaveBeenCalledWith('id', 'fresh-guest-1');
  });
});
