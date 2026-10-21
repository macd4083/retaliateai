import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));

describe('Settings import without Stripe configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not inject a Stripe script when the optional publishable key is missing', async () => {
    await import('../pages/SettingsV2');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('script[src^="https://js.stripe.com/"]')).toBeNull();
  });

  it('does not initialize a preloaded Stripe SDK with an undefined key', async () => {
    const stripe = vi.fn();
    vi.stubGlobal('Stripe', stripe);
    await import('../pages/SettingsV2');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stripe).not.toHaveBeenCalled();
  });
});
