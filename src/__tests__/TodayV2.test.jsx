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
    });
    updateSessionMock.mockResolvedValue({
      checkin_outcome: 'missed',
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

  it('renders the empty-plan state when yesterday has no commitment', async () => {
    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('No plan from yesterday yet'),
      'empty state'
    );

    expect(view.container.textContent).toContain(
      'There isn’t a saved tomorrow commitment to carry into today.'
    );
    expect(view.container.textContent).toContain(
      'Outcome controls unlock after you set a plan in reflection.'
    );
  });

  it('loads the saved outcome, persists updates, and restores the local note fallback', async () => {
    window.localStorage.setItem(
      'retaliateai:today-note:user-1:2026-09-23',
      'Closed the draft and sent it.'
    );

    getTodaySessionMock.mockResolvedValue({
      id: 'session-1',
      date: '2026-09-23',
      checkin_outcome: 'partial',
    });
    maybeSingleMock.mockResolvedValue({
      data: {
        tomorrow_commitment: 'Ship the outreach draft',
        commitment_minimum: 'Write one clean version',
        commitment_stretch: 'Send it to five prospects',
      },
      error: null,
    });

    await renderPage();

    await waitForCondition(
      () => view.container.textContent.includes('Ship the outreach draft'),
      'loaded commitment'
    );

    expect(view.container.textContent).toContain('Outcome saved.');
    expect(view.container.textContent).toContain('Write one clean version');
    expect(view.container.textContent).toContain('Send it to five prospects');

    const textarea = view.container.querySelector('textarea');
    expect(textarea.value).toBe('Closed the draft and sent it.');

    const missedButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Missed'
    );

    await act(async () => {
      missedButton.click();
    });

    await waitForCondition(
      () => updateSessionMock.mock.calls.length === 1,
      'outcome save call'
    );

    expect(updateSessionMock).toHaveBeenCalledWith('session-1', {
      commitment_checkin_done: true,
      checkin_outcome: 'missed',
    });
    expect(view.container.textContent).toContain('Outcome saved.');
  });
});
