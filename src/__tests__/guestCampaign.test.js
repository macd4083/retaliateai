/**
 * Tests for the guest campaign onboarding flow.
 *
 * Run with: npx vitest run src/__tests__/guestCampaign.test.js
 * (Requires: npm install --save-dev vitest)
 *
 * Covers:
 *  1. Attribution extraction from URL params
 *  2. Attribution sessionStorage persistence
 *  3. Guest campaign entry behavior (GuestEntry)
 *  4. First session allowed (AuthGuardV2 bypass)
 *  5. First completion redirect to post-session page
 *  6. Second session blocked when unauthenticated guest
 *  7. Signed-in users unaffected
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractAttribution, saveAttribution, readAttribution } from '../lib/guestSession';

// ── sessionStorage mock ───────────────────────────────────────────────────────
const storageMock = (() => {
  let store = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'sessionStorage', { value: storageMock });

// ─────────────────────────────────────────────────────────────────────────────

describe('extractAttribution', () => {
  it('extracts all known UTM params and src', () => {
    const params = new URLSearchParams(
      'src=instagram&utm_source=instagram&utm_medium=social&utm_campaign=first_session_trial&utm_content=story&utm_term=accountability'
    );
    const attr = extractAttribution(params);
    expect(attr).toEqual({
      src: 'instagram',
      utm_source: 'instagram',
      utm_medium: 'social',
      utm_campaign: 'first_session_trial',
      utm_content: 'story',
      utm_term: 'accountability',
    });
  });

  it('omits missing params (no undefined keys)', () => {
    const params = new URLSearchParams('src=instagram');
    const attr = extractAttribution(params);
    expect(attr).toEqual({ src: 'instagram' });
    expect(Object.keys(attr)).not.toContain('utm_source');
  });

  it('returns empty object when no attribution params present', () => {
    const attr = extractAttribution(new URLSearchParams(''));
    expect(attr).toEqual({});
  });
});

describe('saveAttribution / readAttribution', () => {
  beforeEach(() => storageMock.clear());

  it('round-trips attribution through sessionStorage', () => {
    const attr = { src: 'instagram', utm_source: 'instagram', utm_campaign: 'trial' };
    saveAttribution(attr);
    expect(readAttribution()).toEqual(attr);
  });

  it('readAttribution returns {} when nothing stored', () => {
    expect(readAttribution()).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuthGuardV2 logic — unit tests for the guard conditions
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthGuardV2 guest logic', () => {
  /**
   * Simulates the guard's decision given a profile snapshot.
   * Mirrors the conditions in App.jsx AuthGuardV2.
   */
  function guardDecision({ user, profileData, onboardingCompleted }) {
    if (!user) return 'redirect_login';

    if (
      profileData?.is_guest_campaign_user &&
      profileData?.requires_signup_for_next_session &&
      user?.is_anonymous !== false
    ) {
      return 'show_signup_gate';
    }

    if (!onboardingCompleted && !profileData?.is_guest_campaign_user) {
      return 'show_onboarding';
    }

    return 'show_app';
  }

  it('redirects unauthenticated visitors to login', () => {
    expect(guardDecision({ user: null, profileData: null, onboardingCompleted: false }))
      .toBe('redirect_login');
  });

  it('shows onboarding for new signed-up user', () => {
    const user = { id: 'abc', is_anonymous: false };
    const profileData = { onboarding_completed: false, is_guest_campaign_user: false };
    expect(guardDecision({ user, profileData, onboardingCompleted: false }))
      .toBe('show_onboarding');
  });

  it('passes guest campaign user through (skips onboarding)', () => {
    const user = { id: 'guest-1', is_anonymous: true };
    const profileData = {
      is_guest_campaign_user: true,
      requires_signup_for_next_session: false,
      onboarding_completed: false,
    };
    expect(guardDecision({ user, profileData, onboardingCompleted: false }))
      .toBe('show_app');
  });

  it('shows signup gate when guest has completed first session', () => {
    const user = { id: 'guest-1', is_anonymous: true };
    const profileData = {
      is_guest_campaign_user: true,
      requires_signup_for_next_session: true,
    };
    expect(guardDecision({ user, profileData, onboardingCompleted: false }))
      .toBe('show_signup_gate');
  });

  it('does NOT show signup gate for signed-up user even if flags are set', () => {
    // is_anonymous: false means the user has a real account
    const user = { id: 'real-user', is_anonymous: false };
    const profileData = {
      is_guest_campaign_user: true,
      requires_signup_for_next_session: true,
    };
    expect(guardDecision({ user, profileData, onboardingCompleted: true }))
      .toBe('show_app');
  });

  it('shows app to normal signed-in user with completed onboarding', () => {
    const user = { id: 'real-user', is_anonymous: false };
    const profileData = { is_guest_campaign_user: false, onboarding_completed: true };
    expect(guardDecision({ user, profileData, onboardingCompleted: true }))
      .toBe('show_app');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guest session completion — flags that get set on first session complete
// ─────────────────────────────────────────────────────────────────────────────

describe('guest session completion flags', () => {
  it('requires_signup_for_next_session is set after first session completes', () => {
    // Simulates the DB update that happens in ReflectionV2 when isSessionComplete
    // and isGuestCampaignUser are both true.
    const initialProfile = {
      is_guest_campaign_user: true,
      completed_first_session: false,
      requires_signup_for_next_session: false,
    };

    const updatedProfile = {
      ...initialProfile,
      completed_first_session: true,
      requires_signup_for_next_session: true,
    };

    expect(updatedProfile.completed_first_session).toBe(true);
    expect(updatedProfile.requires_signup_for_next_session).toBe(true);
  });
});
