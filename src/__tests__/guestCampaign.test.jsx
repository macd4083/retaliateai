import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const { posthogMock, supabaseMock } = vi.hoisted(() => ({
  posthogMock: { __loaded: false, init: vi.fn(), capture: vi.fn(), identify: vi.fn(), opt_out_capturing: vi.fn() },
  supabaseMock: { auth: { getSession: vi.fn(), signOut: vi.fn(), signInAnonymously: vi.fn() }, from: vi.fn() },
}));
vi.mock('posthog-js', () => ({ default: posthogMock }));
vi.mock('../lib/supabase/client', () => ({ supabase: supabaseMock }));

import GuestEntry from '../pages/GuestEntry';
import { buildSignupPath, extractAttribution, fetchGuestGuardrailsEnabled, readAttribution, saveAttribution } from '../lib/guestSession';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('guest campaign signup fallback', () => {
  let root;
  let container;

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    posthogMock.__loaded = false;
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });

  it('extracts attribution defensively and preserves signup query parameters', () => {
    expect(extractAttribution()).toEqual({});
    expect(buildSignupPath({ src: 'instagram', utm_source: 'instagram' }, { guest: 'unavailable' }))
      .toBe('/login?signup=true&guest=unavailable&src=instagram&utm_source=instagram');
    saveAttribution({ src: 'instagram', invalid: 'ignored' });
    expect(readAttribution()).toEqual({ src: 'instagram' });
  });

  it.each([false, true])('routes to signup without touching existing auth, even if analytics are blocked: %s', async (blocked) => {
    posthogMock.__loaded = blocked;
    posthogMock.capture.mockImplementation(() => {
      if (blocked) throw new Error('ERR_BLOCKED_BY_CLIENT');
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const router = createMemoryRouter([
      { path: '/start/guest', element: <GuestEntry /> },
      { path: '/login', element: <div>Signup</div> },
    ], { initialEntries: ['/start/guest?src=instagram&utm_source=instagram&utm_campaign=launch'] });
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(router.state.location.pathname).toBe('/login');
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('signup')).toBe('true');
    expect(params.get('guest')).toBe('unavailable');
    expect(params.get('utm_campaign')).toBe('launch');
    expect(readAttribution()).toEqual({ src: 'instagram', utm_source: 'instagram', utm_campaign: 'launch' });
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    expect(supabaseMock.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(container.textContent).toBe('Signup');
  });

  it.each([
    [{ data: null, error: null }, true],
    [{ data: { value: false }, error: null }, false],
    [{ data: null, error: { message: 'boom' } }, true],
  ])('keeps historical guest guardrail config behavior', async (response, expected) => {
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => response }) }),
    });
    await expect(fetchGuestGuardrailsEnabled(supabaseMock)).resolves.toBe(expected);
  });
});
