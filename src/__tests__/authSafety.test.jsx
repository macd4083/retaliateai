import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { supabase, toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
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
      resend: vi.fn(),
    },
    from: vi.fn(),
  },
}));
vi.mock('../lib/supabase/client', () => ({ supabase }));
vi.mock('../lib/supabase', () => ({ supabase }));
vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: { error: toastError, success: vi.fn() },
  Toaster: () => null,
}));

import Login from '../pages/Login';
import EmailConfirmed from '../pages/EmailConfirmed';
import AuthCallback from '../pages/AuthCallback';
import ResetPassword from '../pages/ResetPassword';
import { authHelpers } from '../lib/supabase/auth';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import SettingsV2 from '../pages/SettingsV2';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('auth entry safety', () => {
  let root;
  let container;
  let router;
  let insert;
  let authValue;
  let authEvent;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    const user = { id: 'user-1', email: 'member@example.com' };
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user, session: { user } }, error: null });
    supabase.auth.signUp.mockResolvedValue({ data: { user, session: { user } }, error: null });
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user } }, error: null });
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user }, user }, error: null });
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    supabase.auth.updateUser.mockResolvedValue({ error: null });
    supabase.auth.resend.mockResolvedValue({ error: null });
    supabase.auth.signOut.mockResolvedValue({ error: null });
    supabase.auth.onAuthStateChange.mockImplementation((callback) => {
      authEvent = callback;
      callback('INITIAL_SESSION', { user });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    insert = vi.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({
      insert,
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: 'Member' }, error: null }) }) }),
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    router?.dispose();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  async function render(path, page, withProvider = false) {
    window.history.replaceState({}, '', path);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const routes = [
      { path: '/login', element: <Login /> },
      { path: '/auth/callback', element: page || <EmailConfirmed /> },
      { path: '/auth/reset-password', element: <ResetPassword /> },
      { path: '/settings', element: <SettingsV2 /> },
      { path: '/provider', element: <AuthProvider><AuthProbe /></AuthProvider> },
      { path: '*', element: <div>App destination</div> },
    ];
    router = createMemoryRouter([{
      path: '/',
      element: withProvider ? <AuthProvider><Outlet /></AuthProvider> : <Outlet />,
      children: routes,
    }], { initialEntries: [path] });
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

  it.each([
    ['/login?next=%2Ftoday', '/today'],
    ['/login?next=https%3A%2F%2Fevil.example', '/app'],
  ])('offers unconfirmed accounts a resend action with a safe callback from %s', async (path, expectedReturn) => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });
    await render(path);
    await fill('input[type=email]', 'member@example.com');
    await fill('input[type=password]', 'password123');
    await submit();
    const resend = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Resend confirmation email');
    expect(resend).toBeDefined();
    await act(async () => resend.click());
    const payload = supabase.auth.resend.mock.calls[0][0];
    expect(payload.type).toBe('signup');
    expect(payload.email).toBe('member@example.com');
    const callback = new URL(payload.options.emailRedirectTo);
    expect(callback.origin).toBe(window.location.origin);
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(expectedReturn);
    expect(container.textContent).toContain('Confirmation email sent!');
    expect(router.state.location.pathname).toBe('/login');
  });

  it('surfaces confirmation resend failures and leaves the action retryable', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null }, error: { message: 'Email not confirmed' },
    });
    supabase.auth.resend.mockResolvedValue({ error: { message: 'Please wait before requesting another email.' } });
    await render('/login');
    await fill('input[type=email]', 'member@example.com');
    await fill('input[type=password]', 'password123');
    await submit();
    const resend = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Resend confirmation email');
    await act(async () => resend.click());
    expect(container.textContent).toContain('Please wait before requesting another email.');
    expect(resend.disabled).toBe(false);
    expect(router.state.location.pathname).toBe('/login');
  });

  it('does not offer signup confirmation resend for ordinary credential errors', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null }, error: { message: 'Invalid login credentials' },
    });
    await render('/login');
    await fill('input[type=email]', 'member@example.com');
    await fill('input[type=password]', 'password123');
    await submit();
    expect(container.textContent).not.toContain('Resend confirmation email');
    expect(supabase.auth.resend).not.toHaveBeenCalled();
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

  it.each([undefined, <AuthCallback />])('exchanges an unprocessed PKCE code when no session exists', async (page) => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await render('/auth/callback?code=unprocessed-pkce&next=%2Ftoday', page);
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('unprocessed-pkce');
    if (page) {
      expect(router.state.location.pathname).toBe('/today');
    } else {
      expect(container.textContent).toContain('Email Verified!');
      expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', email: 'member@example.com' });
    }
  });

  it('uses the PKCE fallback when implicit-client initialization returns an error without a session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'PKCE callback requires PKCE flow.' } });
    await render('/auth/callback?code=unprocessed-pkce');
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('unprocessed-pkce');
    expect(container.textContent).toContain('Email Verified!');
  });

  it.each([undefined, <AuthCallback />])('surfaces explicit PKCE exchange errors instead of reporting success', async (page) => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'PKCE code expired. Request a new link.' } });
    await render('/auth/callback?code=expired-pkce', page);
    expect(container.textContent).toContain('PKCE code expired');
    expect(router.state.location.pathname).toBe('/auth/callback');
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([undefined, <AuthCallback />])('keeps recovery events emitted during explicit PKCE exchange on the reset form', async (page) => {
    const user = { id: 'user-1', email: 'member@example.com' };
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    supabase.auth.exchangeCodeForSession.mockImplementation(async () => {
      authEvent('PASSWORD_RECOVERY', { user });
      return { data: { session: { user }, user }, error: null };
    });
    await render('/auth/callback?code=pkce-recovery&next=%2Fhome', page, true);
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('pkce-recovery');
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/home');
    expect(container.textContent).toContain('Create New Password');
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ['/today', '/today'],
    ['/settings', '/settings'],
    ['', '/app'],
    ['https://evil.example', '/app'],
  ])('sends recovery links directly to reset with safe return %s', async (next, expectedReturn) => {
    await render(`/login?reset=true&next=${encodeURIComponent(next)}`);
    await fill('input[type=email]', 'member@example.com');
    await submit();
    const [email, options] = supabase.auth.resetPasswordForEmail.mock.calls[0];
    const resetUrl = new URL(options.redirectTo);
    expect(email).toBe('member@example.com');
    expect(resetUrl.origin).toBe(window.location.origin);
    expect(resetUrl.pathname).toBe('/auth/reset-password');
    expect(resetUrl.searchParams.get('next')).toBe(expectedReturn);
    expect(router.state.location.pathname).toBe('/login');
    expect(container.textContent).toContain('Password reset link sent!');
  });

  it.each(['/today', '/settings'])('preserves %s through implicit recovery callbacks', async (next) => {
    await render(`/auth/callback?next=${encodeURIComponent(next)}#type=recovery`);
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(next);
    expect(insert).not.toHaveBeenCalled();
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

    supabase.auth.updateUser.mockResolvedValueOnce({ error: { message: 'Please try the password update again.' } });
    await submit();
    expect(container.textContent).toContain('Please try the password update again.');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    await submit();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'password123' });
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(router.state.location.pathname).toBe('/app');
  });

  it.each([
    ['/settings', '/settings'],
    ['/today', '/today'],
    ['https://evil.example', '/app'],
  ])('returns to sanitized destination %s only after successful password update', async (next, expectedReturn) => {
    vi.useFakeTimers();
    await render(`/auth/reset-password?next=${encodeURIComponent(next)}`, undefined, true);
    const inputs = container.querySelectorAll('input[type=password]');
    await act(async () => {
      for (const input of inputs) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'password123');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    await submit();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'password123' });
    expect(router.state.location.pathname).toBe('/auth/reset-password');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(router.state.location.pathname).toBe(expectedReturn);
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

  it.each([undefined, <AuthCallback />])(
    'keeps PKCE PASSWORD_RECOVERY events on reset until the password update succeeds',
    async (page) => {
      vi.useFakeTimers();
      let resolveSession;
      supabase.auth.getSession.mockImplementation(() => new Promise((resolve) => { resolveSession = resolve; }));
      await render('/auth/callback?code=pkce-recovery&next=%2Fhome', page, true);
      const user = { id: 'user-1', email: 'member@example.com' };
      await act(async () => {
        authEvent('PASSWORD_RECOVERY', { user });
        resolveSession({ data: { session: { user } }, error: null });
      });
      expect(router.state.location.pathname).toBe('/auth/reset-password');
      expect(insert).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Create New Password');

      await act(async () => router.navigate('/home'));
      expect(router.state.location.pathname).toBe('/auth/reset-password');
      const inputs = container.querySelectorAll('input[type=password]');
      await act(async () => {
        for (const input of inputs) {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'password123');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await submit();
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'password123' });
      expect(router.state.location.pathname).toBe('/auth/reset-password');
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(router.state.location.pathname).toBe('/home');
    }
  );

  it('lets a recovery user explicitly request a new link without entering the app', async () => {
    await render('/auth/reset-password?next=%2Fsettings', undefined, true);
    await act(async () => authEvent('PASSWORD_RECOVERY', { user: { id: 'user-1' } }));
    const requestLink = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Request a new reset link'));
    await act(async () => requestLink.click());
    expect(router.state.location.pathname).toBe('/login');
    const search = new URLSearchParams(router.state.location.search);
    expect(search.get('reset')).toBe('true');
    expect(search.get('next')).toBe('/settings');
    expect(container.textContent).toContain('Send Reset Link');
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('returns Settings logout to a fresh login whose default destination is /app', async () => {
    await render('/settings', undefined, true);
    const signOut = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Sign Out');
    await act(async () => signOut.click());
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('');
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });

  it('keeps Settings and the current user accessible when logout fails', async () => {
    supabase.auth.signOut.mockResolvedValue({ error: new Error('Signout unavailable') });
    await render('/settings', undefined, true);
    const signOut = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Sign Out');
    await act(async () => signOut.click());
    expect(router.state.location.pathname).toBe('/settings');
    expect(container.textContent).toContain('member@example.com');
    expect(toastError).toHaveBeenCalledWith('Signout unavailable');
  });
});
