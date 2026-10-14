import { supabase } from '../../lib/supabase/client';

export const TODAY_V2_MIGRATIONS = [
  '20260928_today_v2_workflow.sql',
  '20261006_today_v2_controllable_and_first_five.sql',
  '20261007_today_v2_scheduling.sql',
  '20261008_today_v2_schedule_review_lock.sql',
  '20261009_today_v2_completion_release_guard.sql',
  '20261010_today_v2_habit_recurrence.sql',
  '20261011_today_v2_day_schedule.sql',
];

const [workflow, firstFive, scheduling, reviewLock, , recurrence, daySchedule] = TODAY_V2_MIGRATIONS;
const probe = (table, columns, migration, tableMigration = workflow, protectedRelation = false) => ({
  table, columns, migration, tableMigration, protectedRelation,
});

export const TODAY_V2_SCHEMA_PROBES = [
  probe('today_v2_daily_reviews', 'id,user_id,local_date,timezone_name,desired_direction,completed_at,updated_at', workflow),
  probe('today_v2_plan_inputs', 'id,user_id,source_local_date,target_local_date,timezone_name,raw_plan_text,parser_version,updated_at', workflow),
  probe('today_v2_commitment_fragments', 'id,user_id,plan_input_id,source_local_date,target_local_date,timezone_name,fragment_order,fragment_text,normalized_fragment_text,completion_state,answered_at,parser_version,created_at,updated_at', workflow),
  probe('today_v2_habit_definitions', 'id,user_id,seed_key,name,response_type,unit,schedule_weekdays,display_order,is_archived,archived_at,created_at,updated_at', workflow),
  probe('today_v2_habit_occurrences', 'id,user_id,habit_definition_id,local_date,timezone_name,scheduled_weekday,snapshot_name,snapshot_response_type,snapshot_unit,snapshot_display_order,boolean_response,numeric_response,answered_at,created_at,updated_at', workflow),
  probe('today_v2_daily_reviews', 'controllable_focus', firstFive),
  probe('today_v2_plan_inputs', 'first_five_minutes', firstFive),
  probe('today_v2_schedule_blocks', 'id,user_id,target_local_date,timezone_name,commitment_fragment_id,habit_definition_id,starts_at,ends_at,created_at,updated_at', scheduling, scheduling),
  probe('today_v2_schedule_blocks', 'source_review_id', reviewLock, scheduling),
  probe('today_v2_habit_definitions', 'planning_mode,schedule_times', recurrence),
  probe('today_v2_schedule_blocks', 'is_automatic', recurrence, scheduling),
  probe('today_v2_habit_schedule_overrides', 'user_id,target_local_date,habit_definition_id', recurrence, recurrence),
  probe('today_v2_day_schedule_writes', 'backend_pid,transaction_id,user_id,target_local_date,timezone_name,source_id,source_type,schedule_id,starts_at,ends_at', daySchedule, daySchedule, true),
];

function classifyError(error, check) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302'
    || /permission denied|not authorized|JWT|access denied/i.test(message)) return 'permission';
  if (/fetch|network|offline|timeout|timed out|connection/i.test(message)
    || ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '57014'].includes(code)) return 'network';
  // PostgREST can hide this deliberately ungranted relation from its cache.
  // Its absence from the API is not proof that the day-schedule migration is missing.
  if (check.protectedRelation && code === 'PGRST205') return 'unknown';
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return 'missing';
  return 'unknown';
}

export async function probeDayScheduleMetadata(client = supabase, options = {}) {
  const url = options.url ?? import.meta.env.VITE_SUPABASE_URL;
  const apiKey = options.apiKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  const fetchRequest = options.fetchRequest ?? globalThis.fetch;
  if (!url || !apiKey || !client.auth?.getSession) return { status: 'unknown', code: null };
  try {
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) return { status: classifyError(sessionError, {}), code: sessionError.code || null };
    if (!data?.session?.access_token) return { status: 'permission', code: null };
    const endpoint = new URL(`${url.replace(/\/$/, '')}/rest/v1/rpc/today_v2_update_day_schedule`);
    const args = {
      p_target_local_date: '2000-01-01',
      p_timezone_name: 'UTC',
      p_source_type: 'action',
      p_source_id: '00000000-0000-0000-0000-000000000000',
      p_starts_at: '2000-01-01T00:00:00Z',
      p_ends_at: '2000-01-01T00:30:00Z',
    };
    Object.entries(args).forEach(([key, value]) => endpoint.searchParams.set(key, value));
    // PostgREST OPTIONS builds a NoDb RoutineInfoPlan; GET/HEAD would execute
    // the volatile function in a read-only transaction and are NOT safe probes.
    const response = await fetchRequest(endpoint.toString(), {
      method: 'OPTIONS',
      headers: { apikey: apiKey, Authorization: ['Bearer', data.session.access_token].join(' '), 'Accept-Profile': 'public' },
    });
    const allow = response.headers.get('Allow');
    if (response.ok && /^OPTIONS\s*,\s*POST$/i.test(allow || '')) {
      return { status: 'available', code: null };
    }
    if (response.ok) return { status: 'unknown', code: null };
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) return { status: 'permission', code: error.code || null };
    if (error.code === 'PGRST202') return { status: 'missing', code: error.code };
    return { status: classifyError(error, { protectedRelation: true }), code: error.code || null };
  } catch (error) {
    return { status: classifyError(error, {}), code: error.code || null };
  }
}

export async function diagnoseTodayV2Schema(client = supabase, options = {}) {
  const checks = await Promise.all(TODAY_V2_SCHEMA_PROBES.map(async (check) => {
    let error;
    try {
      ({ error } = await client.from(check.table).select(check.columns).limit(0));
    } catch (caught) {
      error = caught;
    }
    let status = error ? classifyError(error, check) : 'available';
    let code = error?.code || null;
    if (check.protectedRelation && error && ['permission', 'unknown'].includes(status)) {
      const metadata = await probeDayScheduleMetadata(client, options);
      // Gateway preflight responses may hide PostgREST's metadata response.
      // Keep the original permission failure unless the route gives evidence.
      if (metadata.status !== 'unknown') {
        status = metadata.status;
        code = metadata.code;
      }
    }
    const migration = ['42P01', 'PGRST205'].includes(error?.code) ? check.tableMigration : check.migration;
    return { ...check, migration, status, code };
  }));
  const missingMigrations = TODAY_V2_MIGRATIONS.filter((migration) =>
    checks.some((check) => check.status === 'missing' && check.migration === migration));
  const unresolvedChecks = checks.filter((check) => !['available', 'missing'].includes(check.status));
  return {
    status: missingMigrations.length ? 'missing' : unresolvedChecks.length ? 'unverified' : 'available',
    missingMigrations,
    unresolvedChecks,
    checks,
  };
}
