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
      tomorrow_plan_details: null,
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

  function clickButton(label) {
    const button = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.trim() === label
    );

    button.click();
  }

  it('publishes the structured worksheet into the existing commitment fields', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Ship the revised offer'),
      'worksheet load'
    );

    expect(view.container.textContent).toContain('Part 1 · Review Today');
    expect(view.container.textContent).toContain('Part 2 · Plan Tomorrow');
    expect(view.container.textContent).toContain('Part 3 · Final confirmation');

    await act(async () => {
      changeField('plan-result-value', 'Sent the revision and got clear objections back.');
      changeField('plan-benefit-from-action', 'I now know the exact objection blocking the sale.');
      changeField('plan-cost-of-inaction', 'I would still be guessing and delaying outreach.');
      changeField('plan-repeated-trajectory', 'More avoidance would keep revenue flat.');
      changeField('plan-becoming', 'Someone who faces the signal instead of hiding from it.');
      changeField('plan-lesson', 'I need the draft ready before my afternoon energy drops.');
      changeField('plan-desired-direction', 'A seller who learns from direct contact with reality.');
      changeField('plan-value-to-strengthen', 'Directness and consistency.');
      changeField('plan-primary-action', 'Call the three warm leads before noon.');
      changeField('plan-completion-definition', 'Three calls placed and notes logged in the CRM.');
      changeField('plan-additional-actions', 'Send follow-up emails to any lead I miss by phone.');
      changeField('plan-start-plan', 'At 9:00 AM from the office with the lead sheet open.');
      changeField('plan-obstacle', 'I may drift into admin work first.');
      changeField('plan-tonight-preparation', 'Lay out the lead sheet and draft the first call opener.');
    });

    await act(async () => {
      clickButton('Partly');
      clickButton('Mixed');
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

    expect(publishButton.disabled).toBe(false);

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
        tomorrow_commitment: 'Call the three warm leads before noon.',
        commitment_minimum: 'Three calls placed and notes logged in the CRM.',
        commitment_stretch: 'Send follow-up emails to any lead I miss by phone.',
        commitment_why: 'A seller who learns from direct contact with reality. | Directness and consistency.',
        commitment_checkin_done: true,
        checkin_outcome: 'partial',
        tomorrow_plan_details: expect.objectContaining({
          workflow: 'structured_plan_v1',
          what: 'Call the three warm leads before noon.',
          when_where: 'At 9:00 AM from the office with the lead sheet open.',
          review_today: expect.objectContaining({
            highest_roi_action: 'Ship the revised offer',
            completion_status: 'partial',
          }),
          plan_tomorrow: expect.objectContaining({
            desired_direction: 'A seller who learns from direct contact with reality.',
            value_to_strengthen: 'Directness and consistency.',
            obstacle: 'I may drift into admin work first.',
          }),
        }),
      })
    );

    expect(view.container.textContent).toContain(
      'Tomorrow’s action is published. It will carry into Today on the next day.'
    );
  });
});
