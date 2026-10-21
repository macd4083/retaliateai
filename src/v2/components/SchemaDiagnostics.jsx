import { useEffect } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { diagnoseTodayV2Schema, TODAY_V2_MIGRATIONS } from '../services/schemaDiagnostics';

export default function SchemaDiagnostics() {
  const { user, loading: authLoading } = useAuth();
  const userId = !authLoading && user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let retryTimer;
    async function checkSchema(isRetry = false) {
      try {
        const result = await diagnoseTodayV2Schema();
        if (!active || result.status === 'available') return;
        console.error('Database schema could not be fully verified', {
          status: result.status,
          missingMigrations: result.missingMigrations,
          unresolvedChecks: result.unresolvedChecks,
          failedChecks: result.checks?.filter((check) => check.status !== 'available'),
        });
      } catch (error) {
        if (!active) return;
        console.error('Database schema verification failed', {
          migrations: TODAY_V2_MIGRATIONS,
          message: error?.message || String(error),
          stack: error?.stack,
        });
      }
      if (!isRetry && active) retryTimer = setTimeout(() => checkSchema(true), 30_000);
    }
    void checkSchema();
    return () => {
      active = false;
      clearTimeout(retryTimer);
    };
  }, [userId]);

  return null;
}
