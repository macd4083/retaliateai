import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { supabase } = vi.hoisted(() => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      getSession: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
  },
}));
vi.mock('../lib/supabase/client', () => ({ supabase }));
vi.mock('../lib/supabase', () => ({ supabase }));
vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }));

import Login from '../pages/Login';
import EmailConfirmed from '../pages/EmailConfirmed';
import AuthCallback from '../pages/AuthCallback';
import ResetPassword from '../pages/ResetPassword';
import { authHelpers } from '../lib/supabase/auth';
import { AuthProvider, useAuth } from '../lib/AuthContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('auth entry safety', () => {
  let root;
  let container;
  let router;
  let insert;
  let authValue;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    const user = { id: 'user-1', email: 'member@example.com' };
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user, session: { user } }, error: null });
    supabase.auth.signUp.mockResolvedValue({ data: { user, session: { user } }, error: null });
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user } }, error: null });
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    supabase.auth.updateUser.mockResolvedValue({ error: null });
    supabase.auth.signOut.mockResolvedValue({ error: null });
    supabase.auth.onAuthStateChange.mockImplementation((callback) => {
      callback('INITIAL_SESSION', { user });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    insert = vi.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({ insert });
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    router?.dispose();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  async function render(path, page) {
    window.history.replaceState({}, '', path);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    router = createMemoryRouter([
      { path: '/login', element: <Login /> },
      { path: '/auth/callback', element: page || <EmailConfirmed /> },
      { path: '/auth/reset-password', element: <ResetPassword /> },
      { path: '/provider', element: <AuthProvider><AuthProbe /></AuthProvider> },
      { path: '*', element: <div>App destination</div> },
    ], { initialEntries: [path] });
    await act(async () => root.render(<RouterProvider router={router} />));
  }

  function AuthProbe() {
    authValue = useAuth();
    return <div>{authValue.user?.id || 'Signed out'}</div>;
  }

  async function fill(selector, value) {
    const input = container.querySelector(selector);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submit() {
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }

  it.each([
    ['/login', '/app'],
    ['/login?next=%2Ftoday%3Fsource%3Dreminder', '/today?source=reminder'],
    ['/login?next=https%3A%2F%2Fevil.example%2Ftoday', '/app'],
    ['/login?next=%2Fauth%2Fcallback', '/app'],
  ])('signs in from %s to the safe destination', async (path, expected) => {
    await render(path);
    await fill('input[type=email]', 'member@example.com');
    await fill('input[type=password]', 'password123');
    await submit();
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'member@example.com', password: 'password123' });
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(expected);
  });

  it('handles immediate signup sessions and carries safe targets into email confirmation', async () => {
    await render('/login?signup=true&next=%2Ftoday');
    await fill('input[type=email]', 'member@example.com');
    await fill('input[type=password]', 'password123');
    await submit();
    expect(router.state.location.pathname).toBe('/today');
    const callback = new URL(supabase.auth.signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe('/today');
  });

  it('keeps emailed signup waiting for confirmation when no session is returned', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: null }, error: null });
    await render('/login?signup=true');
    await fill('input[type=email]', 'member@example.com');
    await fill('input[type=password]', 'password123');
    await submit();
    expect(router.state.location.pathname).toBe('/login');
    expect(container.textContent).toContain('Check your email');
  });

  it('defaults the shared signup helper to the application callback target', async () => {
    await authHelpers.signUp('member@example.com', 'password123');
    const callback = new URL(supabase.auth.signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.searchParams.get('next')).toBe('/app');
  });

  it('preserves cross-device verification events and offers a safe app continuation', async () => {
    await render('/auth/callback?next=%2Fhome');
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', email: 'member@example.com' });
    expect(container.textContent).toContain('Email Verified!');
    await act(async () => container.querySelector('button').click());
    expect(router.state.location.pathname).toBe('/home');
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('does not report success for an expired link merely because another session exists', async () => {
    await render('/auth/callback#error=access_denied&error_description=Link+expired');
    expect(container.textContent).toContain('Verification Failed');
    expect(container.textContent).toContain('Link expired');
    expect(insert).not.toHaveBeenCalled();
  });

  it('keeps recovery callbacks on the reset form instead of entering the app', async () => {
    await render('/auth/callback#type=recovery');
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    expect(container.textContent).toContain('Create New Password');
    expect(insert).not.toHaveBeenCalled();
  });

  it('leaves the alternate callback as an auth handler, without double-exchanging a PKCE code', async () => {
    await render('/auth/callback?code=already-processed&next=%2Ftoday', <AuthCallback />);
    expect(router.state.location.pathname).toBe('/today');
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('sends recovery links directly to the reset route', async () => {
    await render('/login?reset=true&next=%2Ftoday');
    await fill('input[type=email]', 'member@example.com');
    await submit();
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    expect(router.state.location.pathname).toBe('/login');
    expect(container.textContent).toContain('Password reset link sent!');
  });

  it('updates a password on the public reset form before returning to /app', async () => {
    vi.useFakeTimers();
    await render('/auth/reset-password');
    await fill('input[type=password]', 'password123');
    const inputs = container.querySelectorAll('input[type=password]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inputs[1], 'password123');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'password123' });
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(router.state.location.pathname).toBe('/app');
  });

  it('keeps reset failures usable without prematurely navigating into the app', async () => {
    supabase.auth.updateUser.mockResolvedValue({ error: { message: 'Recovery session expired. Request a new link.' } });
    await render('/auth/reset-password');
    const inputs = container.querySelectorAll('input[type=password]');
    await act(async () => {
      for (const input of inputs) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'password123');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await submit();
    expect(container.textContent).toContain('Recovery session expired');
    expect(container.textContent).toContain('Request a new reset link');
    expect(router.state.location.pathname).toBe('/auth/reset-password');
  });

  it('does not clear the current user when signout fails', async () => {
    const error = new Error('Signout unavailable');
    supabase.auth.signOut.mockResolvedValue({ error });
    await render('/provider');
    await expect(authValue.signOut()).rejects.toThrow('Signout unavailable');
    expect(container.textContent).toBe('user-1');
  });

  it('clears the authenticated user after successful signout', async () => {
    await render('/provider');
    await act(async () => authValue.signOut());
    expect(container.textContent).toBe('Signed out');
  });
});
