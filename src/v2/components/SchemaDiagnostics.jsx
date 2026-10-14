import React, { useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { diagnoseTodayV2Schema } from '../services/schemaDiagnostics';

export default function SchemaDiagnostics() {
  const { user, loading: authLoading } = useAuth();
  const userId = !authLoading && user?.id;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setState({ userId, loading: true });
    diagnoseTodayV2Schema().then((result) => {
      if (active) setState({ userId, result });
    }).catch(() => {
      if (active) setState({ userId, failed: true });
    });
    return () => { active = false; };
  }, [userId, attempt]);

  if (!userId || state?.userId !== userId) return null;
  if (state.result?.status === 'available') return null;
  const result = state.result;
  const unresolvedMigrations = [...new Set(result?.unresolvedChecks.map((check) => check.migration))];
  return (
    <aside role={result?.status === 'missing' ? 'alert' : 'status'} aria-label="Database schema diagnostics"
      className="relative z-50 border-b border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <strong>{state.loading ? 'Checking database schema…'
        : result?.status === 'missing' ? 'Database schema update required' : 'Database schema could not be fully verified'}</strong>
      {!!result?.missingMigrations.length && (
        <>
          <p>Missing required tables or columns. Apply or verify these migrations in production, in this order:</p>
          <ol className="list-inside list-decimal">
            {result.missingMigrations.map((migration) => <li key={migration}><code className="break-all font-semibold">{migration}</code></li>)}
          </ol>
          <p>If already applied, check the API schema cache. Habit fallback does not restore scheduling support.</p>
        </>
      )}
      {!!unresolvedMigrations.length && (
        <>
          <p>Unverified migrations (not confirmed missing):</p>
          <ul>{unresolvedMigrations.map((migration) => <li key={migration}><code className="break-all">{migration}</code></li>)}</ul>
          <p>Permissions, network failures, or API visibility may prevent this read-only check.
            The day-schedule capability table is intentionally private; an administrator must verify its migration in SQL.</p>
          <p>Check results: {[...new Set(result.unresolvedChecks.map((check) => check.status))].join(', ')}.</p>
        </>
      )}
      {state.failed && <p>Schema check failed. No migration is confirmed missing. Check your connection and permissions, then retry.</p>}
      {!state.loading && <p>This read-only check does not execute scheduling RPCs or verify function/trigger bodies.</p>}
      <button type="button" disabled={state.loading} onClick={() => setAttempt((value) => value + 1)}
        className="mt-2 rounded border border-amber-700 px-3 py-1 disabled:opacity-50">
        {state.loading ? 'Checking…' : 'Retry schema check'}
      </button>
    </aside>
  );
}
