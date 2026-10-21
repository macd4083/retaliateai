import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { user: null, loading: false }, diagnose: vi.fn() }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../v2/services/schemaDiagnostics', () => ({ diagnoseTodayV2Schema: mocks.diagnose }));
import SchemaDiagnostics from '../v2/components/SchemaDiagnostics';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const available = { status: 'available', missingMigrations: [], unresolvedChecks: [] };
const missing = {
  status: 'missing',
  missingMigrations: ['20261010_today_v2_habit_recurrence.sql', '20261011_today_v2_day_schedule.sql'],
  unresolvedChecks: [],
};

describe('global authenticated schema diagnostics', () => {
  let root;
  let container;
  const render = () => act(async () => root.render(<SchemaDiagnostics />));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { user: { id: 'user' }, loading: false };
    mocks.diagnose.mockResolvedValue(available);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not probe or display for signed-out users or pending authentication', async () => {
    mocks.auth = { user: null, loading: false };
    await render();
    mocks.auth = { user: { id: 'user' }, loading: true };
    await render();
    expect(mocks.diagnose).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('prominently lists exact missing recurrence and day filenames globally', async () => {
    mocks.diagnose.mockResolvedValue(missing);
    await render();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.querySelector('details').open).toBe(true);
    expect([...container.querySelectorAll('ol code')].map((node) => node.textContent)).toEqual(missing.missingMigrations);
    expect(container.textContent).toContain('Habit fallback does not restore scheduling support');
  });

  it('retries and clears the warning after successful verification', async () => {
    mocks.diagnose.mockResolvedValueOnce(missing).mockResolvedValueOnce(available);
    await render();
    await act(async () => container.querySelector('button').click());
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('');
  });

  it('distinguishes unverified private day schema from missing migrations', async () => {
    mocks.diagnose.mockResolvedValue({
      ...available, status: 'unverified',
      unresolvedChecks: [{ migration: '20261011_today_v2_day_schedule.sql', status: 'permission' }],
    });
    await render();
    expect(container.textContent).toContain('Unverified migrations (not confirmed missing)');
    expect(container.textContent).toContain('20261011_today_v2_day_schedule.sql');
    expect(container.textContent).toContain('permission');
    expect(container.querySelector('ol')).toBeNull();
    expect(container.querySelector('details').open).toBe(false);
    expect(container.querySelector('summary code').textContent).toContain('20261011_today_v2_day_schedule.sql');
  });

  it('does not mislabel unexpected probe failure as missing schema', async () => {
    mocks.diagnose.mockRejectedValue(new Error('unexpected'));
    await render();
    expect(container.textContent).toContain('No migration is confirmed missing');
    expect(container.querySelector('button').disabled).toBe(false);
  });

  it('keeps diagnostics nonmodal and does not block unrelated saves', async () => {
    const save = vi.fn();
    mocks.diagnose.mockResolvedValue(missing);
    await act(async () => root.render(<>
      <div className="fixed top-14 left-0 right-0 z-[90] max-h-[50vh] overflow-y-auto"><SchemaDiagnostics /></div>
      <button onClick={save}>Save review</button>
    </>));
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Save review');
    expect(button.disabled).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const panelClasses = container.firstElementChild.className;
    expect(container.querySelector('aside').className).not.toContain('fixed');
    expect(panelClasses).toContain('fixed');
    expect(panelClasses).toContain('top-14');
    expect(panelClasses).toContain('z-[90]');
    expect(panelClasses).toContain('max-h-[50vh]');
    expect(panelClasses).toContain('overflow-y-auto');
    await act(async () => button.click());
    expect(save).toHaveBeenCalledOnce();
  });

  it('ignores stale probes and clears account diagnostics immediately on signout', async () => {
    let resolve;
    mocks.diagnose.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await render();
    expect(container.querySelector('button').disabled).toBe(true);
    mocks.auth = { user: null, loading: false };
    await render();
    await act(async () => resolve(missing));
    expect(container.textContent).toBe('');
  });

  it('probes new accounts independently and never exposes previous-user results', async () => {
    mocks.diagnose.mockResolvedValueOnce(missing).mockResolvedValueOnce(available);
    await render();
    mocks.auth = { user: { id: 'other' }, loading: false };
    await render();
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('');
  });
});
