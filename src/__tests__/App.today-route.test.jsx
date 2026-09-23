import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const { authState, fromMock } = vi.hoisted(() => ({
  authState: {
    user: { id: 'user-1' },
    loading: false,
  },
  fromMock: vi.fn(),
}));

vi.mock('../pages/TodayV2', () => ({
  default: () => <div>Today Page</div>,
}));

vi.mock('../pages/PlanV2', () => ({
  default: () => <div>Plan Page</div>,
}));

vi.mock('../pages/ReflectionV2', () => ({
  default: () => <div>Reflection Page</div>,
}));

vi.mock('../pages/InsightsV2', () => ({
  default: () => <div>Insights Page</div>,
}));

vi.mock('../pages/SettingsV2', () => ({
  default: () => <div>Settings Page</div>,
}));

vi.mock('../pages/OnboardingV2', () => ({
  default: () => <div>Onboarding Page</div>,
}));

vi.mock('../pages/AdminV2', () => ({
  default: () => <div>Admin Page</div>,
}));

vi.mock('../pages/AdminFeedback', () => ({
  default: () => <div>Admin Feedback</div>,
}));

vi.mock('../pages/AdminSessionLog', () => ({
  default: () => <div>Admin Session Log</div>,
}));

vi.mock('../pages/admin/LiveDemo', () => ({
  default: () => <div>Live Demo</div>,
}));

vi.mock('../pages/admin/LiveDemoInsights', () => ({
  default: () => <div>Live Demo Insights</div>,
}));

vi.mock('../pages/Login', () => ({
  default: () => <div>Login Page</div>,
}));

vi.mock('../pages/ResetPassword', () => ({
  default: () => <div>Reset Password</div>,
}));

vi.mock('../pages/EmailConfirmed', () => ({
  default: () => <div>Email Confirmed</div>,
}));

vi.mock('../pages/PrivacyPolicy', () => ({
  default: () => <div>Privacy</div>,
}));

vi.mock('../pages/TermsOfService', () => ({
  default: () => <div>Terms</div>,
}));

vi.mock('../pages/Landing', () => ({
  default: () => <div>Landing Page</div>,
}));

vi.mock('../components/TrialExpiredModal', () => ({
  default: () => null,
}));

vi.mock('../pages/GuestEntry', () => ({
  default: () => <div>Guest Entry</div>,
}));

vi.mock('../pages/PostSessionNextSteps', () => ({
  default: () => <div>Next Steps</div>,
}));

vi.mock('../lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock('../lib/usePageTracking', () => ({
  usePageTracking: () => {},
}));

vi.mock('../lib/analytics', () => ({
  stopAnalytics: () => {},
}));

vi.mock('../lib/guestSession', () => ({
  isAnonymousGuestUser: (user) => user?.is_anonymous === true,
}));

vi.mock('../lib/trialModal', () => ({
  shouldShowTrialExpiredModal: () => false,
}));

vi.mock('../lib/supabase/profileSchema', () => ({
  isMissingProfileColumn: () => false,
}));

import App from '../App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function createProfileQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        onboarding_completed: true,
        trial_ends_at: null,
        subscription_status: null,
        feedback_submitted: false,
        trial_extended: false,
        role: 'user',
        is_guest_campaign_user: false,
      },
      error: null,
    }),
  };

  return query;
}

describe('App today routing', () => {
  let view;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'user-1' };
    authState.loading = false;
    fromMock.mockImplementation((table) => {
      if (table !== 'user_profiles') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return createProfileQuery();
    });
  });

  afterEach(async () => {
    if (view) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
      view = null;
    }
  });

  async function renderApp(initialEntry) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <App />
        </MemoryRouter>
      );
    });

    view = { container, root };
    return view;
  }

  it('renders the protected /today route for authenticated users', async () => {
    await renderApp('/today');

    await waitForCondition(
      () => view.container.textContent.includes('Today Page'),
      '/today route render'
    );

    expect(view.container.textContent).toContain('Today Page');
  });

  it('renders the protected /plan route for authenticated users', async () => {
    await renderApp('/plan');

    await waitForCondition(
      () => view.container.textContent.includes('Plan Page'),
      '/plan route render'
    );

    expect(view.container.textContent).toContain('Plan Page');
  });

  it('redirects unknown routes to /today for authenticated users', async () => {
    await renderApp('/does-not-exist');

    await waitForCondition(
      () => view.container.textContent.includes('Today Page'),
      'catch-all redirect'
    );

    expect(view.container.textContent).toContain('Today Page');
  });

  it('redirects unknown routes to the landing page for unauthenticated users', async () => {
    authState.user = null;

    await renderApp('/does-not-exist');

    await waitForCondition(
      () => view.container.textContent.includes('Landing Page'),
      'public catch-all redirect'
    );

    expect(view.container.textContent).toContain('Landing Page');
  });
});
