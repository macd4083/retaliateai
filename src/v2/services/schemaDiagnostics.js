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

export async function diagnoseTodayV2Schema(client = supabase) {
  const checks = await Promise.all(TODAY_V2_SCHEMA_PROBES.map(async (check) => {
    let error;
    try {
      ({ error } = await client.from(check.table).select(check.columns, { head: true }).limit(0));
    } catch (caught) {
      error = caught;
    }
    const status = error ? classifyError(error, check) : 'available';
    const migration = ['42P01', 'PGRST205'].includes(error?.code) ? check.tableMigration : check.migration;
    return { ...check, migration, status, code: error?.code || null };
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
