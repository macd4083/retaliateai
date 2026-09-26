import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const {
  navigateMock,
  getTodaySessionMock,
  updateSessionMock,
  loadTomorrowPlanActionsMock,
  publishTomorrowPlanMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getTodaySessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  loadTomorrowPlanActionsMock: vi.fn(),
  publishTomorrowPlanMock: vi.fn(),
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
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../lib/supabase/reflection', () => ({
  reflectionHelpers: {
    getTodaySession: getTodaySessionMock,
    updateSession: updateSessionMock,
  },
}));

vi.mock('../lib/supabase/dailyWorkflow', () => ({
  dailyWorkflow: {
    loadTomorrowPlanActions: loadTomorrowPlanActionsMock,
    publishTomorrowPlan: publishTomorrowPlanMock,
  },
  offsetDateStr: (dateStr, offsetDays) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12);
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
      date: '2026-09-25',
      tomorrow_plan_details: null,
    });

    loadTomorrowPlanActionsMock.mockResolvedValue([]);

    publishTomorrowPlanMock.mockResolvedValue([
      { id: 'plan-1' },
      { id: 'plan-2' },
    ]);

    updateSessionMock.mockResolvedValue({ id: 'session-1' });
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
  }

  function findButton(text) {
    return Array.from(view.container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent.includes(text)
    );
  }

  function setInputValue(id, value) {
    const field = view.container.querySelector(`#${id}`);
    const prototype = field.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('requires user-authored desired direction and primary measured action before publishing', async () => {
    await renderPage();

    await waitForCondition(
      () => findButton('Commit to Tomorrow'),
      'publish button render'
    );

    const publishButton = findButton('Commit to Tomorrow');
    expect(publishButton.disabled).toBe(true);

    await act(async () => {
      setInputValue('plan-desired-direction', 'I am becoming someone who executes before overthinking.');
      setInputValue('plan-action-text-0', 'Call three warm leads before noon.');
      setInputValue('plan-action-measure-0', '3 calls with notes logged');
      setInputValue('plan-action-minimum-0', 'At least one completed call');
      view.container.querySelector('#plan-confirm-checkbox').click();
    });

    await waitForCondition(() => publishButton.disabled === false, 'publish enabled');
  });

  it('keeps additional actions bounded and subordinate', async () => {
    await renderPage();

    await waitForCondition(
      () => findButton('Add optional action'),
      'add optional action button'
    );

    await act(async () => {
      findButton('Add optional action').click();
      findButton('Add optional action').click();
    });

    const maybeThirdAdd = findButton('Add optional action');
    if (maybeThirdAdd) {
      await act(async () => {
        maybeThirdAdd.click();
      });
    }

    expect(findButton('Add optional action')).toBeUndefined();
    expect(view.container.querySelector('#plan-action-text-3')).toBeNull();

    expect(view.container.textContent).toContain('Additional action 1');
    expect(view.container.textContent).toContain('Additional action 2');
  });

  it('prefers published plan rows over stale session draft actions when restoring', async () => {
    getTodaySessionMock.mockResolvedValueOnce({
      id: 'session-1',
      date: '2026-09-25',
      tomorrow_plan_details: {
        plan_tomorrow_draft: {
          desired_direction: 'Stale draft direction',
          actions: [
            {
              action_text: 'Old draft action',
              completion_measure: 'Old measure',
              minimum_version: 'Old minimum',
            },
          ],
        },
      },
    });
    loadTomorrowPlanActionsMock.mockResolvedValueOnce([
      {
        id: 'plan-published-1',
        action_text: 'Published action text',
        completion_measure: 'Published measure',
        minimum_version: 'Published minimum',
        stretch_version: null,
        is_primary: true,
      },
    ]);

    await renderPage();

    await waitForCondition(
      () => view.container.querySelector('#plan-action-text-0'),
      'plan action field'
    );

    expect(view.container.querySelector('#plan-action-text-0').value).toBe('Published action text');
    expect(view.container.querySelector('#plan-action-measure-0').value).toBe('Published measure');
    expect(view.container.querySelector('#plan-action-minimum-0').value).toBe('Published minimum');
  });

  it('restores legacy minimum/stretch commitment fields using split commitment rows', async () => {
    getTodaySessionMock.mockResolvedValueOnce({
      id: 'session-1',
      date: '2026-09-25',
      tomorrow_commitment: 'Minimum: Call three leads. Stretch: Send two follow-ups.',
      commitment_minimum: null,
      commitment_stretch: null,
      commitment_why: 'I am becoming more consistent.',
      tomorrow_plan_details: null,
    });
    loadTomorrowPlanActionsMock.mockResolvedValueOnce([]);

    await renderPage();

    await waitForCondition(
      () => view.container.querySelector('#plan-action-text-0'),
      'legacy split action field'
    );

    expect(view.container.querySelector('#plan-action-text-0').value).toBe('Minimum: Call three leads');
    expect(view.container.querySelector('#plan-action-text-1').value).toBe('Stretch: Send two follow-ups');
    expect(view.container.querySelector('#plan-desired-direction').value).toBe('I am becoming more consistent.');
  });

  it('saves drafts separately and publishes separate rows with backward-compatible fields on confirm', async () => {
    await renderPage();

    await waitForCondition(
      () => findButton('Save draft'),
      'save draft button'
    );

    await act(async () => {
      setInputValue('plan-desired-direction', 'I am becoming consistent with direct sales outreach.');
      setInputValue('plan-action-text-0', 'Call three warm leads before noon.');
      setInputValue('plan-action-measure-0', '3 calls completed with CRM notes');
      setInputValue('plan-action-minimum-0', 'At least 1 call completed');
      setInputValue('plan-action-stretch-0', '5 total calls with follow-up messages');
      findButton('Add optional action').click();
    });

    await waitForCondition(
      () => view.container.querySelector('#plan-action-text-1'),
      'first additional action field'
    );

    await act(async () => {
      setInputValue('plan-action-text-1', 'Send two proposal follow-ups');
      setInputValue('plan-action-measure-1', '2 tailored emails sent');
      findButton('Save draft').click();
    });

    await waitForCondition(() => updateSessionMock.mock.calls.length >= 1, 'draft session save call');
    expect(updateSessionMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      tomorrow_plan_details: expect.objectContaining({
        plan_tomorrow_draft: expect.objectContaining({
          desired_direction: 'I am becoming consistent with direct sales outreach.',
          actions: expect.arrayContaining([
            expect.objectContaining({ action_text: 'Call three warm leads before noon.' }),
            expect.objectContaining({ action_text: 'Send two proposal follow-ups' }),
          ]),
        }),
      }),
    }));
    expect(publishTomorrowPlanMock).not.toHaveBeenCalled();

    await act(async () => {
      view.container.querySelector('#plan-confirm-checkbox').click();
      findButton('Commit to Tomorrow').click();
    });

    await waitForCondition(() => publishTomorrowPlanMock.mock.calls.length === 1, 'publish rows call');

    expect(publishTomorrowPlanMock).toHaveBeenCalledWith(expect.objectContaining({
      planDate: '2026-09-26',
      actions: expect.arrayContaining([
        expect.objectContaining({ is_primary: true, action_text: 'Call three warm leads before noon.' }),
        expect.objectContaining({ is_primary: false, action_text: 'Send two proposal follow-ups' }),
      ]),
    }));

    expect(updateSessionMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        tomorrow_commitment: 'Call three warm leads before noon.',
        commitment_minimum: 'At least 1 call completed',
        commitment_stretch: '5 total calls with follow-up messages',
        commitment_why: 'I am becoming consistent with direct sales outreach.',
        tomorrow_plan_details: expect.objectContaining({
          plan_tomorrow: expect.objectContaining({
            desired_direction: 'I am becoming consistent with direct sales outreach.',
            actions: expect.any(Array),
          }),
          published_plan_action_ids: ['plan-1', 'plan-2'],
        }),
      })
    );
  });
});
