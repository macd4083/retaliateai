import { describe, expect, it } from 'vitest';

import { shouldShowTrialExpiredModal } from '../lib/trialModal';

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
