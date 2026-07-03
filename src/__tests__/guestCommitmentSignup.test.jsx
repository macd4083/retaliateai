import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}));

vi.mock('../lib/analytics', () => ({
  trackEvent: trackEventMock,
}));

import GuestSignupGate from '../components/GuestSignupGate';
import { shouldPromptGuestSignupAfterCommitment } from '../lib/guestSession';

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

async function renderRouter(initialEntry, routes) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  return { container, root, router };
}

describe('guest commitment signup conversion', () => {
  let view;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('shows modal copy and routes CTA to signup', async () => {
    view = await renderRouter('/gate', [
      {
        path: '/gate',
        element: (
          <GuestSignupGate
            mode="modal"
            context="commitment_capture"
            attribution={{ src: 'instagram', utm_source: 'instagram' }}
          />
        ),
      },
      { path: '/login', element: <div>Login</div> },
    ]);

    await waitForCondition(
      () => view.container.textContent.includes('Save your commitment for tomorrow'),
      'modal title'
    );
    expect(view.container.textContent).toContain(
      'To stay accountable and come back to your commitment tomorrow, create your account to save this session.'
    );

    const cta = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create account'
    );
    expect(cta).toBeTruthy();
    await act(async () => {
      cta.click();
    });

    await waitForCondition(() => view.router.state.location.pathname === '/login', 'signup route');
    const params = new URLSearchParams(view.router.state.location.search);
    expect(params.get('signup')).toBe('true');
    expect(params.get('src')).toBe('instagram');
    expect(params.get('utm_source')).toBe('instagram');
  });

  it('does not emit duplicate modal shown event on re-render in same state', async () => {
    view = await renderRouter('/gate', [
      {
        path: '/gate',
        element: <GuestSignupGate mode="modal" context="commitment_capture" attribution={{ src: 'instagram' }} />,
      },
    ]);

    await waitForCondition(
      () => trackEventMock.mock.calls.some(([event]) => event === 'guest_commitment_signup_modal_shown'),
      'modal shown event'
    );

    await act(async () => {
      view.root.render(<RouterProvider router={view.router} />);
    });

    const shownEvents = trackEventMock.mock.calls.filter(
      ([event]) => event === 'guest_commitment_signup_modal_shown'
    );
    expect(shownEvents).toHaveLength(1);
  });

  it('prompts only when first tomorrow commitment is captured for a guest', () => {
    expect(
      shouldPromptGuestSignupAfterCommitment({
        isGuestUser: true,
        previousCommitment: null,
        nextCommitment: 'I will wake up at 6 and train for 30 minutes.',
        hasPromptBeenShown: false,
      })
    ).toBe(true);

    expect(
      shouldPromptGuestSignupAfterCommitment({
        isGuestUser: true,
        previousCommitment: 'I will wake up at 6 and train for 30 minutes.',
        nextCommitment: 'I will wake up at 6 and train for 30 minutes.',
        hasPromptBeenShown: false,
      })
    ).toBe(false);

    expect(
      shouldPromptGuestSignupAfterCommitment({
        isGuestUser: true,
        previousCommitment: null,
        nextCommitment: 'I will wake up at 6 and train for 30 minutes.',
        hasPromptBeenShown: true,
      })
    ).toBe(false);
  });
});
