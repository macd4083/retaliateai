import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const {
  navigateMock,
  getTodaySessionMock,
  getYesterdayCommitmentMock,
  updateSessionMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getTodaySessionMock: vi.fn(),
  getYesterdayCommitmentMock: vi.fn(),
  updateSessionMock: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../components/v2/AppShellV2', () => ({
  default: ({ title, children }) => (
    <div data-testid="app-shell">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
  }),
}));

vi.mock('../lib/supabase/reflection', () => ({
  reflectionHelpers: {
    getTodaySession: getTodaySessionMock,
    getYesterdayCommitment: getYesterdayCommitmentMock,
    updateSession: updateSessionMock,
  },
}));

import PlanV2 from '../pages/PlanV2';

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

describe('PlanV2', () => {
  let view;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    getTodaySessionMock.mockResolvedValue({
      id: 'session-1',
      date: '2026-09-23',
      checkin_outcome: 'partial',
      tomorrow_commitment: null,
      tomorrow_plan_details: {
        review_today: {
          highest_roi_action: 'Ship the revised offer',
          repeated_trajectory: 'If repeated, this builds direct customer feedback loops.',
          lesson: 'Prepare call notes before lunch.',
          completion_status: 'partial',
        },
      },
      commitment_why: null,
    });
    getYesterdayCommitmentMock.mockResolvedValue('Ship the revised offer');
    updateSessionMock.mockImplementation(async (_sessionId, updates) => ({
      tomorrow_commitment: updates.tomorrow_commitment,
      tomorrow_plan_details: updates.tomorrow_plan_details,
    }));
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

  async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlanV2 />);
    });

    view = { container, root };
    return view;
  }

  function changeField(id, value) {
    const field = view.container.querySelector(`#${id}`);
    const prototype = field.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor.set.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('uses Today review evidence as planning context and publishes tomorrow commitment fields', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Evidence carried from Today'),
      'plan load'
    );

    expect(view.container.textContent).toContain('Ship the revised offer');
    expect(view.container.textContent).toContain('Prepare call notes before lunch.');

    await act(async () => {
      changeField('plan-desired-direction', 'A seller who iterates from real objections.');
      changeField('plan-value-to-strengthen', 'Directness and consistency.');
      changeField('plan-primary-action', 'Call three warm leads before noon.');
      changeField('plan-completion-definition', 'Three calls completed with notes in CRM.');
      changeField('plan-additional-actions', 'Email follow-ups to any lead I miss by phone.');
      changeField('plan-start-plan', '9:00 AM at my desk with the call list open.');
      changeField('plan-obstacle', 'I may hide in admin tasks.');
      changeField('plan-fallback-action', 'Make one call within 10 minutes no matter what.');
      changeField('plan-tonight-preparation', 'Print call list and script opening line tonight.');
      const checkbox = view.container.querySelector('#plan-confirm-checkbox');
      checkbox.click();
    });

    const publishButton = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.includes('Publish tomorrow’s action')
    );

    await waitForCondition(
      () => publishButton.disabled === false,
      'publish button enabled'
    );

    await act(async () => {
      publishButton.click();
    });

    await waitForCondition(
      () => updateSessionMock.mock.calls.length === 1,
      'publish call'
    );

    expect(updateSessionMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        tomorrow_commitment: 'Call three warm leads before noon.',
        commitment_minimum: 'Three calls completed with notes in CRM.',
        commitment_stretch: 'Email follow-ups to any lead I miss by phone.',
        commitment_why: 'A seller who iterates from real objections. | Directness and consistency.',
        commitment_checkin_done: true,
        checkin_outcome: 'partial',
        tomorrow_plan_details: expect.objectContaining({
          workflow: 'structured_plan_v1',
          what: 'Call three warm leads before noon.',
          review_today: expect.objectContaining({
            highest_roi_action: 'Ship the revised offer',
            lesson: 'Prepare call notes before lunch.',
          }),
          plan_tomorrow: expect.objectContaining({
            obstacle: 'I may hide in admin tasks.',
            minimum_action_if_blocked: 'Make one call within 10 minutes no matter what.',
          }),
        }),
      })
    );
  });

  it('shows a fallback prompt when review evidence is missing', async () => {
    getYesterdayCommitmentMock.mockResolvedValueOnce('');
    getTodaySessionMock.mockResolvedValueOnce({
      id: 'session-1',
      date: '2026-09-23',
      checkin_outcome: null,
      tomorrow_commitment: null,
      tomorrow_plan_details: null,
      commitment_why: null,
    });

    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Complete Today’s Review first'),
      'missing review prompt'
    );
  });
});
