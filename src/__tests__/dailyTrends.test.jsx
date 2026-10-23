import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBecomingTrend, buildCommitmentTrend } from '../v2/today/trends';
import TrendChart from '../v2/components/TrendChart';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('daily chart series', () => {
  it('uses the last seven review dates, with missing ratings left empty', () => {
    const points = buildBecomingTrend([
      { local_date: '2026-10-15', becoming_rating: 6 },
      { local_date: '2026-10-16', becoming_rating: 1 },
      { local_date: '2026-10-21', becoming_rating: 10 },
      { local_date: '2026-10-22', becoming_rating: null },
      { local_date: '2026-10-23', becoming_rating: 8 },
    ], '2026-10-22');
    expect(points).toHaveLength(7);
    expect(points[0]).toEqual({ date: '2026-10-16', value: 1 });
    expect(points.at(-2)).toEqual({ date: '2026-10-21', value: 10 });
    expect(points.at(-1).value).toBeNull();
  });

  it('counts actual kept answers, preserves zero, and prefers V2 over legacy scores', () => {
    const points = buildCommitmentTrend([
      { target_local_date: '2026-10-20', completion_state: 'kept' },
      { target_local_date: '2026-10-20', completion_state: 'not_kept' },
      { target_local_date: '2026-10-20', completion_state: 'unanswered' },
      { target_local_date: '2026-10-21', completion_state: 'not_kept' },
      { target_local_date: '2026-10-22', completion_state: 'unanswered' },
    ], [
      { date: '2026-10-19', commitment_score: 80 },
      { date: '2026-10-20', commitment_score: 100 },
      { date: '2026-10-22', commitment_score: 100 },
    ], '2026-10-22');
    expect(points.slice(-4).map((point) => point.value)).toEqual([80, 50, 0, null]);
  });

  it('supports trailing month, year and untruncated all-time history across leap days', () => {
    expect(buildCommitmentTrend([], [], '2024-03-01', '1M')).toHaveLength(30);
    expect(buildCommitmentTrend([], [], '2024-03-01', '1Y')).toHaveLength(365);
    const all = buildCommitmentTrend([], [{ date: '2020-01-01', commitment_score: 0 }], '2026-10-22', 'ALL');
    expect(all.length).toBeGreaterThan(2000);
    expect(all[0]).toEqual({ date: '2020-01-01', value: 0 });
    expect(all.at(-1).date).toBe('2026-10-22');
  });
});

describe('fine-line chart', () => {
  let root;
  let container;
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });
  async function render(points) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<TrendChart title="Becoming" description="Past 7 days" points={points} min={1} max={10} unit="/10" />));
  }

  it('breaks the line at missing days and exposes values to keyboard and table readers', async () => {
    await render([
      { date: '2026-10-20', value: 3 },
      { date: '2026-10-21', value: null },
      { date: '2026-10-22', value: 8 },
    ]);
    expect(container.querySelector('[data-trend-line]').getAttribute('d').match(/M/g)).toHaveLength(2);
    expect(container.textContent).toContain('8/10');
    const svg = container.querySelector('svg');
    await act(async () => svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(container.querySelector('[aria-live]').textContent).toContain('2026');
    expect(container.textContent).toContain('No entry');
    await act(async () => svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(container.querySelector('p.text-2xl').textContent).toBe('3/10');
    await act(async () => {
      const details = container.querySelector('details');
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows an honest empty state rather than a zero or fabricated line', async () => {
    await render([{ date: '2026-10-22', value: null }]);
    expect(container.textContent).toContain('No entries in this period yet.');
    expect(container.querySelector('[data-trend-line]').getAttribute('d')).toBe('');
  });
});
