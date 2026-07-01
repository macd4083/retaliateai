import { describe, expect, it } from 'vitest';

import { isGuestCampaignUser } from '../App';
import { isAnonymousGuestUser } from '../lib/guestSession';
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

  describe('guest detection helpers', () => {
    it('detects anonymous users from app_metadata provider', () => {
      expect(
        isAnonymousGuestUser({
          app_metadata: { provider: 'anonymous' },
        })
      ).toBe(true);
    });

    it('treats anonymous users as guest campaign users even without guest profile flags', () => {
      expect(
        isGuestCampaignUser(
          { is_guest_campaign_user: false },
          {
            app_metadata: { provider: 'anonymous' },
          }
        )
      ).toBe(true);
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
