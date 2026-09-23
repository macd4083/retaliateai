import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const {
  navigateMock,
  getTodaySessionMock,
  updateSessionMock,
  fromMock,
  maybeSingleMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getTodaySessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  fromMock: vi.fn(),
  maybeSingleMock: vi.fn(),
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
    updateSession: updateSessionMock,
  },
}));

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: fromMock,
  },
}));

import TodayV2 from '../pages/TodayV2';

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

function createReflectionSessionsQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: maybeSingleMock,
  };

  return query;
}

describe('TodayV2', () => {
  let view;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    getTodaySessionMock.mockResolvedValue({
      id: 'session-1',
      date: '2026-09-23',
      checkin_outcome: null,
      tomorrow_plan_details: null,
    });
    updateSessionMock.mockResolvedValue({
      id: 'session-1',
    });
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: null,
    });
    fromMock.mockImplementation((table) => {
      if (table !== 'reflection_sessions') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return createReflectionSessionsQuery();
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

  async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<TodayV2 />);
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

  async function fillRequiredReviewFields() {
    await act(async () => {
      changeField('today-highest-roi-action', 'Close the pricing proposal loop');
      clickButton('Partly');
      changeField('today-result-value', 'I sent one revised proposal and identified the blocker.');
      changeField('today-benefit-from-action', 'I now know the exact objection to resolve tomorrow.');
      changeField('today-cost-of-inaction', 'Delay would keep revenue timing uncertain.');
      changeField('today-repeated-trajectory', 'Repeating this pace would steadily improve sales confidence.');
      changeField('today-becoming', 'Someone who follows through despite discomfort.');
      clickButton('Unsure');
      changeField('today-lesson', 'Prepare proposal notes before my late-day energy dip.');
    });
  }

  it('lets users without a previous plan complete review and continue to /plan', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('There was no previous-night commitment saved.'),
      'no prior plan helper text'
    );

    await fillRequiredReviewFields();

    const submitButton = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.includes('Submit Today’s Review')
    );

    await waitForCondition(() => submitButton.disabled === false, 'submit enabled');

    await act(async () => {
      submitButton.click();
    });

    await waitForCondition(
      () => updateSessionMock.mock.calls.length === 1,
      'review save call'
    );

    expect(updateSessionMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        checkin_outcome: 'partial',
        commitment_checkin_done: true,
        tomorrow_plan_details: expect.objectContaining({
          workflow: 'structured_plan_v1',
          review_today: expect.objectContaining({
            highest_roi_action: 'Close the pricing proposal loop',
            completion_status: 'partial',
            lesson: 'Prepare proposal notes before my late-day energy dip.',
          }),
        }),
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/plan');
    expect(navigateMock).not.toHaveBeenCalledWith('/reflection');
  });

  it('names the missing required answers instead of silently blocking submit', async () => {
    await renderPage();

    const submitButton = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.includes('Submit Today’s Review')
    );

    await act(async () => {
      submitButton.click();
    });

    await waitForCondition(
      () => view.container.textContent.includes('Please answer: today’s highest-ROI action'),
      'named validation guidance'
    );

    expect(view.container.textContent).toContain('whether you completed it');
    expect(view.container.textContent).toContain('what today taught you');
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it('prefills highest-ROI action and outcome when previous data exists', async () => {
    getTodaySessionMock.mockResolvedValue({
      id: 'session-1',
      date: '2026-09-23',
      checkin_outcome: 'missed',
      tomorrow_plan_details: {
        review_today: {
          lesson: 'Existing lesson',
        },
      },
    });
    maybeSingleMock.mockResolvedValue({
      data: {
        tomorrow_commitment: 'Ship the outreach draft',
        commitment_minimum: 'Write one clean version',
        commitment_stretch: 'Send to five leads',
      },
      error: null,
    });

    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Ship the outreach draft'),
      'prefilled yesterday plan'
    );

    const actionField = view.container.querySelector('#today-highest-roi-action');
    expect(actionField.value).toBe('Ship the outreach draft');

    const noButton = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.trim() === 'No'
    );
    expect(noButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows non-shaming conditional prompts based on completion status', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('What tangible result or value did it create?'),
      'initial prompt'
    );

    await act(async () => {
      clickButton('No');
    });

    await waitForCondition(
      () => view.container.textContent.includes('What was delayed or lost, what interfered, or what did you learn?'),
      'missed prompt'
    );

    await act(async () => {
      clickButton('Partly');
    });

    await waitForCondition(
      () => view.container.textContent.includes('What progress did it create, and what remains?'),
      'partial prompt'
    );
  });

  it('blocks transition and shows an error when review save fails', async () => {
    updateSessionMock.mockRejectedValueOnce(new Error('save failed'));

    await renderPage();
    await fillRequiredReviewFields();

    const submitButton = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.includes('Submit Today’s Review')
    );

    await act(async () => {
      submitButton.click();
    });

    await waitForCondition(
      () => view.container.textContent.includes('Could not save today’s review. Please try again.'),
      'save failure text'
    );

    expect(view.container.querySelector('#today-highest-roi-action').value).toBe('Close the pricing proposal loop');
    expect(view.container.querySelector('#today-lesson').value).toBe('Prepare proposal notes before my late-day energy dip.');
    expect(navigateMock).not.toHaveBeenCalledWith('/plan');
  });
});
