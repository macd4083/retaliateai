import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('scheduler rollout flag', () => {
  it.each([undefined, 'false', 'TRUE', '1', 'true'])('enables only literal true (%s)', async (value) => {
    vi.stubEnv('VITE_ENABLE_TODAY_V2_SCHEDULER', value);
    vi.resetModules();
    const { ENABLE_TODAY_V2_SCHEDULER } = await import('../lib/featureFlags');
    expect(ENABLE_TODAY_V2_SCHEDULER).toBe(value === 'true');
  });
});
