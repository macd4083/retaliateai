import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadStripe: vi.fn(),
  elements: vi.fn(({ children }) => children),
}));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: mocks.loadStripe }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: mocks.elements,
  CardElement: () => null,
  useElements: () => null,
  useStripe: () => null,
}));
vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'member@example.test' }, signOut: vi.fn() }),
}));
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: { display_name: 'Member', subscription_status: 'active' } }),
    }) }) }),
  },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => children }));
vi.mock('../lib/featureFlags', () => ({ ENABLE_TODAY_V2_SCHEDULER: false }));
vi.mock('../v2/components/GoogleCalendarConnection', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Stripe initialization boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.loadStripe.mockResolvedValue({ configured: true });
  });

  afterEach(() => vi.unstubAllEnvs());

  async function loadSettings(key) {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', key);
    return (await import('../pages/SettingsV2')).default;
  }

  it.each([undefined, '', '   ', 'sk_test_private', 'malformed', 'pk_test_'])(
    'does not pass an absent or invalid key to Stripe: %s', async (key) => {
      const Settings = await loadSettings(key);
      expect(Settings).toBeTypeOf('function');
      expect(mocks.loadStripe).not.toHaveBeenCalled();
    }
  );

  it('passes a normalized valid public key to Stripe', async () => {
    await loadSettings('  pk_test_example123  ');
    expect(mocks.loadStripe).toHaveBeenCalledExactlyOnceWith('pk_test_example123');
  });

  it.each(['missing', 'failed'])('keeps settings usable when Stripe is %s', async (failure) => {
    if (failure === 'failed') mocks.loadStripe.mockRejectedValue(new Error('SDK unavailable'));
    const Settings = await loadSettings(failure === 'failed' ? 'pk_live_example123' : undefined);
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Settings />));
      expect(container.textContent).toContain('Member');
      expect(container.textContent).toContain('Payment method updates are temporarily unavailable');
      expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Update Payment Method').disabled)
        .toBe(true);
      expect(mocks.elements).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
