import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAnonymousGuestUser } from '../lib/guestSession';
import { shouldShowTrialExpiredModal } from '../lib/trialModal';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'user-1' }, loading: false },
  profile: { onboarding_completed: true },
  routeTarget: vi.fn(),
}));

vi.mock('../lib/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/usePageTracking', () => ({ usePageTracking: vi.fn() }));
vi.mock('../lib/analytics', () => ({ stopAnalytics: vi.fn() }));
vi.mock('../v2/services/todayReview', () => ({ getTodayV2RouteTarget: mocks.routeTarget }));
vi.mock('../lib/supabase/client', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profile, error: null }) }) }),
  }) },
}));
vi.mock('../v2/pages/TodayV2Page', () => ({ default: () => <div>Structured Today</div> }));
vi.mock('../v2/pages/HomeV2Page', () => ({ default: () => <div>Structured Home</div> }));
vi.mock('../pages/OnboardingV2', () => ({
  default: ({ onOnboardingComplete }) => <button onClick={onOnboardingComplete}>Complete onboarding</button>,
}));
vi.mock('../pages/Login', () => ({ default: () => <div>Login</div> }));
vi.mock('../pages/ResetPassword', () => ({ default: () => <div>Reset Password</div> }));
vi.mock('../pages/EmailConfirmed', () => ({ default: () => <div>Email Confirmation</div> }));
vi.mock('../pages/Landing', () => ({ default: () => <div>Public Landing</div> }));
vi.mock('../pages/InsightsV2', () => ({ default: () => <div>Insights</div> }));
vi.mock('../pages/SettingsV2', () => ({ default: () => <div>Settings</div> }));
vi.mock('../pages/AdminV2', () => ({ default: () => null }));
vi.mock('../pages/AdminFeedback', () => ({ default: () => null }));
vi.mock('../pages/AdminSessionLog', () => ({ default: () => null }));
vi.mock('../pages/admin/LiveDemo', () => ({ default: () => null }));
vi.mock('../pages/admin/LiveDemoInsights', () => ({ default: () => null }));
vi.mock('../pages/PrivacyPolicy', () => ({ default: () => null }));
vi.mock('../pages/TermsOfService', () => ({ default: () => null }));
vi.mock('../pages/GuestEntry', () => ({ default: () => null }));
vi.mock('../pages/PostSessionNextSteps', () => ({ default: () => null }));
vi.mock('../components/TrialExpiredModal', () => ({ default: () => null }));

import App from '../App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('shouldShowTrialExpiredModal', () => {
  it('does not show the trial-expired modal for guest users', () => {
    expect(
      shouldShowTrialExpiredModal(
        {
          trial_ends_at: '2026-01-01T00:00:00.000Z',
          subscription_status: 'inactive',
          feedback_submitted: false,
          trial_extended: false,
          role: 'user',
        },
        {
          isGuestUser: true,
          now: new Date('2026-01-08T00:00:00.000Z'),
        }
      )
    ).toBe(false);
  });

  describe('structured app routes', () => {
    let root;
    let container;
    let router;

    beforeEach(() => {
      mocks.auth = { user: { id: 'user-1' }, loading: false };
      mocks.profile = { onboarding_completed: true };
      mocks.routeTarget.mockReset().mockResolvedValue('/today');
    });

    afterEach(async () => {
      if (root) await act(async () => root.unmount());
      container?.remove();
      router?.dispose();
      vi.unstubAllEnvs();
    });

    async function render(path) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [path] });
      await act(async () => root.render(<RouterProvider router={router} />));
    }

    it.each(['/app', '/reflection', '/legacy/reflection', '/unknown'])('routes %s to Today for incomplete reviews', async (path) => {
      await render(path);
      expect(router.state.location.pathname).toBe('/today');
      expect(container.textContent).toBe('Structured Today');
      expect(mocks.routeTarget).toHaveBeenCalledWith('user-1');
    });

    it.each(['/app', '/reflection', '/legacy/reflection'])('routes %s to Home for completed reviews', async (path) => {
      mocks.routeTarget.mockResolvedValue('/home');
      await render(path);
      expect(router.state.location.pathname).toBe('/home');
      expect(container.textContent).toBe('Structured Home');
    });

    it('falls back to Today on route lookup failures', async () => {
      mocks.routeTarget.mockRejectedValue(new Error('offline'));
      await render('/app');
      expect(router.state.location.pathname).toBe('/today');
    });

    it.each(
      ['true', 'false'].flatMap((flag) =>
        ['/app', '/reflection', '/legacy/reflection', '/unknown'].flatMap((path) =>
          ['/today', '/home'].map((target) => [flag, path, target])
        )
      )
    )('ignores retired flag %s when resolving %s to %s', async (flag, path, target) => {
      vi.stubEnv('VITE_ENABLE_TODAY_V2', flag);
      mocks.routeTarget.mockResolvedValue(target);
      await render(path);
      expect(router.state.location.pathname).toBe(target);
      expect(container.textContent).toBe(target === '/today' ? 'Structured Today' : 'Structured Home');
      expect(mocks.routeTarget).toHaveBeenCalledWith('user-1');
    });

    it.each([
      ['/today', 'Structured Today'],
      ['/home', 'Structured Home'],
    ])('keeps explicit %s stable', async (path, text) => {
      await render(path);
      expect(router.state.location.pathname).toBe(path);
      expect(container.textContent).toBe(text);
      expect(mocks.routeTarget).not.toHaveBeenCalled();
    });

    it('preserves protected deep links through login', async () => {
      mocks.auth.user = null;
      await render('/today?source=reminder#review');
      expect(router.state.location.pathname).toBe('/login');
      expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/today?source=reminder#review');
    });

    it('requires login through legacy bookmarks', async () => {
      mocks.auth.user = null;
      await render('/legacy/reflection');
      expect(router.state.location.pathname).toBe('/login');
      expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/app');
      expect(mocks.routeTarget).not.toHaveBeenCalled();
    });

    it.each(['/auth/reset-password', '/auth/callback'])('keeps %s public for recovery and confirmation', async (path) => {
      mocks.auth.user = null;
      await render(path);
      expect(router.state.location.pathname).toBe(path);
      expect(mocks.routeTarget).not.toHaveBeenCalled();
    });

    it('waits for onboarding before resolving the daily destination', async () => {
      mocks.profile = { onboarding_completed: false };
      await render('/app');
      expect(container.textContent).toBe('Complete onboarding');
      expect(mocks.routeTarget).not.toHaveBeenCalled();
      await act(async () => container.querySelector('button').click());
      expect(router.state.location.pathname).toBe('/today');
    });

    it.each(['/today', '/legacy/reflection'])('preserves the anonymous guest onboarding bypass on %s', async (path) => {
      mocks.auth.user = { id: 'guest-1', is_anonymous: true };
      mocks.profile = { onboarding_completed: false };
      await render(path);
      expect(router.state.location.pathname).toBe('/today');
      expect(container.textContent).toBe('Structured Today');
    });

    it('redirects legacy bookmarks for guest campaign profiles after account transfer', async () => {
      mocks.profile = { onboarding_completed: false, is_guest_campaign_user: true };
      await render('/legacy/reflection');
      expect(router.state.location.pathname).toBe('/today');
      expect(container.textContent).toBe('Structured Today');
    });
  });

  describe('guest detection helpers', () => {
    it('detects anonymous users from explicit is_anonymous flag', () => {
      expect(isAnonymousGuestUser({ is_anonymous: true })).toBe(true);
    });

    it('detects anonymous users from app_metadata provider', () => {
      expect(
        isAnonymousGuestUser({
          app_metadata: { provider: 'anonymous' },
        })
      ).toBe(true);
    });

    it('detects anonymous users from identities fallback', () => {
      expect(
        isAnonymousGuestUser({
          identities: [{ provider: 'anonymous' }],
        })
      ).toBe(true);
    });

    it('returns false for invalid or non-anonymous shapes', () => {
      expect(isAnonymousGuestUser(null)).toBe(false);
      expect(isAnonymousGuestUser(undefined)).toBe(false);
      expect(isAnonymousGuestUser('anonymous')).toBe(false);
      expect(isAnonymousGuestUser({ identities: [] })).toBe(false);
      expect(isAnonymousGuestUser({ app_metadata: { provider: 'email' } })).toBe(false);
    });
  });

  it('still shows the trial-expired modal for non-guest expired trials', () => {
    expect(
      shouldShowTrialExpiredModal(
        {
          trial_ends_at: '2026-01-01T00:00:00.000Z',
          subscription_status: 'inactive',
          feedback_submitted: false,
          trial_extended: false,
          role: 'user',
        },
        {
          isGuestUser: false,
          now: new Date('2026-01-08T00:00:00.000Z'),
        }
      )
    ).toBe(true);
  });
});
