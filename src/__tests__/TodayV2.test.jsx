import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const {
  navigateMock,
  getTodaySessionMock,
  updateSessionMock,
  loadReviewDataMock,
  saveActionReviewsMock,
  saveHabitCheckinsMock,
  saveHabitMock,
  archiveHabitMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getTodaySessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  loadReviewDataMock: vi.fn(),
  saveActionReviewsMock: vi.fn(),
  saveHabitCheckinsMock: vi.fn(),
  saveHabitMock: vi.fn(),
  archiveHabitMock: vi.fn(),
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
    loadReviewData: loadReviewDataMock,
    saveActionReviews: saveActionReviewsMock,
    saveHabitCheckins: saveHabitCheckinsMock,
    saveHabit: saveHabitMock,
    archiveHabit: archiveHabitMock,
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

describe('TodayV2', () => {
  let view;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    getTodaySessionMock.mockResolvedValue({
      id: 'session-1',
      date: '2026-09-25',
      tomorrow_plan_details: null,
    });

    loadReviewDataMock.mockResolvedValue({
      planActions: [
        {
          id: 'plan-1',
          action_text: 'Call three customers',
          completion_measure: '3 calls with notes',
          is_primary: true,
        },
        {
          id: 'plan-2',
          action_text: 'Send follow-up emails',
          completion_measure: '2 follow-ups',
          is_primary: false,
        },
      ],
      actionReviews: [],
      habits: [
        {
          id: 'habit-1',
          name: 'Sleep',
          input_type: 'number',
          unit: 'hours',
          scheduled_days: [1, 2, 3, 4, 5, 6, 0],
        },
      ],
      checkins: [],
      yesterdayCommitment: 'Call three customers',
    });

    saveActionReviewsMock.mockResolvedValue(undefined);
    saveHabitCheckinsMock.mockResolvedValue(undefined);
    saveHabitMock.mockResolvedValue({
      id: 'habit-2',
      name: 'Meditate',
      input_type: 'boolean',
      unit: null,
      scheduled_days: [1, 2, 3, 4, 5],
      display_order: 1,
    });
    updateSessionMock.mockResolvedValue({ id: 'session-1' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
  }

  function findButton(text) {
    return Array.from(view.container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent.includes(text)
    );
  }

  function findButtonByLabel(label) {
    return view.container.querySelector(`button[aria-label="${label}"]`);
  }

  function setInputValue(id, value) {
    const field = view.container.querySelector(`#${id}`);
    const prototype = field.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('renders previous planned actions as separate primary and secondary rows', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Call three customers'),
      'planned actions render'
    );

    expect(view.container.textContent).toContain('Primary action');
    expect(view.container.textContent).toContain('Secondary action');
    expect(view.container.querySelector('#today-action-text-0').value).toBe('Call three customers');
    expect(view.container.querySelector('#today-action-text-1').value).toBe('Send follow-up emails');
  });

  it('lets no-previous-plan users submit retrospective evidence and continue to /plan', async () => {
    loadReviewDataMock.mockResolvedValueOnce({
      planActions: [],
      actionReviews: [],
      habits: [],
      checkins: [],
      yesterdayCommitment: null,
    });

    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('What were today’s highest-ROI actions?'),
      'retrospective helper text'
    );
    expect(view.container.querySelector('#today-action-text-0')).toBeNull();
    expect(view.container.textContent).not.toContain('Primary action');

    await act(async () => {
      findButton('Add action').click();
    });

    await waitForCondition(() => view.container.querySelector('#today-action-text-0'), 'first retrospective action field');

    await act(async () => {
      setInputValue('today-action-text-0', 'Drafted the launch brief');
      findButton('Done').click();
    });

    await act(async () => {
      findButton('Save review and plan tomorrow').click();
    });

    await waitForCondition(() => saveActionReviewsMock.mock.calls.length === 1, 'save action reviews call');

    expect(saveActionReviewsMock).toHaveBeenCalledWith(expect.objectContaining({
      reviewDate: '2026-09-25',
      rows: expect.arrayContaining([
        expect.objectContaining({ action_text: 'Drafted the launch brief', outcome: 'done' }),
      ]),
    }));
    expect(navigateMock).toHaveBeenCalledWith('/plan');
    expect(navigateMock).not.toHaveBeenCalledWith('/reflection');
  });

  it('preserves entered values and blocks navigation when save fails', async () => {
    loadReviewDataMock.mockResolvedValueOnce({
      planActions: [],
      actionReviews: [],
      habits: [],
      checkins: [],
      yesterdayCommitment: null,
    });
    saveActionReviewsMock.mockRejectedValueOnce(new Error('boom'));

    await renderPage();

    await act(async () => {
      findButton('Add action').click();
    });

    await waitForCondition(
      () => view.container.querySelector('#today-action-text-0'),
      'first action input'
    );

    await act(async () => {
      setInputValue('today-action-text-0', 'Call three customers');
      findButton('Done').click();
    });

    await act(async () => {
      findButton('Save review and plan tomorrow').click();
    });

    await waitForCondition(
      () => view.container.textContent.includes('Could not save today’s review.'),
      'save error'
    );

    expect(view.container.querySelector('#today-action-text-0').value).toBe('Call three customers');
    expect(navigateMock).not.toHaveBeenCalledWith('/plan');
  });

  it('opens habit modal from add button and saves selected weekdays', async () => {
    await renderPage();

    await waitForCondition(
      () => findButtonByLabel('Add habit'),
      'add habit button'
    );

    await act(async () => {
      findButtonByLabel('Add habit').click();
    });

    await waitForCondition(
      () => view.container.querySelector('[role="dialog"]'),
      'habit modal'
    );

    await act(async () => {
      setInputValue('habit-name', 'Meditate');
      const monday = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.trim() === 'M');
      monday.click();
      const saturday = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Sa');
      saturday.click();
      const saveButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Save');
      saveButton.click();
    });

    await waitForCondition(() => saveHabitMock.mock.calls.length === 1, 'habit save call');

    expect(saveHabitMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: 'Meditate',
        scheduled_days: expect.arrayContaining([2, 3, 4, 5]),
      })
    );
  });

  it('archives a habit from the overflow menu', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Sleep'),
      'habit row render'
    );

    await act(async () => {
      const menuButtons = view.container.querySelectorAll('button[aria-haspopup=\"menu\"]');
      menuButtons[0].click();
    });

    await act(async () => {
      const archiveButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Delete');
      archiveButton.click();
    });

    await waitForCondition(() => archiveHabitMock.mock.calls.length === 1, 'archive call');
    expect(archiveHabitMock).toHaveBeenCalledWith('user-1', 'habit-1');
  });

  it('loads legacy yesterday commitment fragments as follow-through rows when no published plan exists', async () => {
    loadReviewDataMock.mockResolvedValueOnce({
      planActions: [],
      actionReviews: [],
      habits: [],
      checkins: [],
      yesterdayCommitment: 'Minimum: Call three customers. Stretch: Send follow-up emails.',
      yesterdayCommitmentMinimum: null,
      yesterdayCommitmentStretch: null,
    });

    await renderPage();

    await waitForCondition(
      () => view.container.querySelector('#today-action-text-0'),
      'legacy action rows'
    );

    expect(view.container.querySelector('#today-action-text-0').value).toBe('Minimum: Call three customers');
    expect(view.container.querySelector('#today-action-text-1').value).toBe('Stretch: Send follow-up emails');
    expect(view.container.textContent).toContain('Primary action');
    expect(view.container.textContent).toContain('Secondary action');
  });
});
