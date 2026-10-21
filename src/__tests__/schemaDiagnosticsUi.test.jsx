import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { user: null, loading: false }, diagnose: vi.fn() }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../v2/services/schemaDiagnostics', async (importOriginal) => ({
  ...await importOriginal(),
  diagnoseTodayV2Schema: mocks.diagnose,
}));
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
  let consoleError;
  const render = () => act(async () => root.render(<SchemaDiagnostics />));
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.auth = { user: { id: 'user' }, loading: false };
    mocks.diagnose.mockResolvedValue(available);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not probe or display for signed-out users or pending authentication', async () => {
    mocks.auth = { user: null, loading: false };
    await render();
    mocks.auth = { user: { id: 'user' }, loading: true };
    await render();
    expect(mocks.diagnose).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('logs exact missing recurrence and day filenames without rendering UI', async () => {
    mocks.diagnose.mockResolvedValue(missing);
    await render();
    expect(container.innerHTML).toBe('');
    expect(consoleError).toHaveBeenCalledWith('Database schema could not be fully verified',
      expect.objectContaining({ status: 'missing', missingMigrations: missing.missingMigrations }));
  });

  it('retries in the background and stops after successful verification', async () => {
    mocks.diagnose.mockResolvedValueOnce(missing).mockResolvedValueOnce(available);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('');
    expect(consoleError).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs unverified private day schema context without a banner or retry button', async () => {
    const error = new Error('permission denied');
    const check = {
      migration: '20261011_today_v2_day_schedule.sql', status: 'permission',
      code: '42501', message: error.message, stack: error.stack,
    };
    mocks.diagnose.mockResolvedValue({
      ...available, status: 'unverified',
      unresolvedChecks: [check], checks: [check],
    });
    await render();
    expect(container.innerHTML).toBe('');
    expect(consoleError).toHaveBeenCalledWith('Database schema could not be fully verified', {
      status: 'unverified', missingMigrations: [], unresolvedChecks: [check], failedChecks: [check],
    });
  });

  it('logs unexpected probe failures with message, migration context, and stack', async () => {
    const error = new Error('unexpected');
    mocks.diagnose.mockRejectedValue(error);
    await render();
    expect(container.innerHTML).toBe('');
    expect(consoleError).toHaveBeenCalledWith('Database schema verification failed', {
      migrations: expect.arrayContaining(['20261011_today_v2_day_schedule.sql']),
      message: 'unexpected', stack: error.stack,
    });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limits persistent schema failures to one background retry', async () => {
    mocks.diagnose.mockResolvedValue(missing);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not log or retry healthy schema checks', async () => {
    await render();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps diagnostics nonmodal and does not block unrelated saves', async () => {
    const save = vi.fn();
    mocks.diagnose.mockResolvedValue(missing);
    await act(async () => root.render(<>
      <div className="fixed top-14 left-0 right-0 z-[90] max-h-[50vh] overflow-y-auto"><SchemaDiagnostics /></div>
      <div role="alert">Unable to save calendar changes</div>
      <button onClick={save}>Save review</button>
    </>));
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Save review');
    expect(button.disabled).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.firstElementChild.innerHTML).toBe('');
    expect(container.querySelector('[role="alert"]').textContent).toBe('Unable to save calendar changes');
    await act(async () => button.click());
    expect(save).toHaveBeenCalledOnce();
  });

  it('ignores stale probes and clears account diagnostics immediately on signout', async () => {
    let resolve;
    mocks.diagnose.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await render();
    expect(container.innerHTML).toBe('');
    mocks.auth = { user: null, loading: false };
    await render();
    await act(async () => resolve(missing));
    expect(container.textContent).toBe('');
    expect(consoleError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('probes new accounts independently and never exposes previous-user results', async () => {
    mocks.diagnose.mockResolvedValueOnce(missing).mockResolvedValueOnce(available);
    await render();
    mocks.auth = { user: { id: 'other' }, loading: false };
    await render();
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending retries on signout and unmount', async () => {
    mocks.diagnose.mockResolvedValue(missing);
    await render();
    expect(vi.getTimerCount()).toBe(1);
    mocks.auth = { user: null, loading: false };
    await render();
    expect(vi.getTimerCount()).toBe(0);
    mocks.auth = { user: { id: 'other' }, loading: false };
    await render();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.diagnose).toHaveBeenCalledTimes(2);
  });
});
