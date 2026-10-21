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
const probe = (table, columns, migration, tableMigration = workflow) => ({
  table, columns, migration, tableMigration,
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
];

function classifyError(error, schemaErrors = true) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302'
    || /permission denied|not authorized|JWT|access denied|authentication required/i.test(message)) return 'permission';
  if (/fetch|network|offline|timeout|timed out|connection/i.test(message)
    || ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '57014'].includes(code)) return 'network';
  if (schemaErrors && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return 'missing';
  return 'unknown';
}

function errorContext(error) {
  return {
    ...(error?.message ? { message: error.message } : typeof error === 'string' ? { message: error } : {}),
    ...(error?.stack ? { stack: error.stack } : {}),
  };
}

export async function probeDayScheduleMetadata(client = supabase, options = {}) {
  const url = options.url ?? import.meta.env.VITE_SUPABASE_URL;
  const apiKey = options.apiKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  const fetchRequest = options.fetchRequest ?? globalThis.fetch;
  if (!url || !apiKey || !client.auth?.getSession) return { status: 'unknown', code: null };
  try {
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) return { status: classifyError(sessionError, false), code: sessionError.code || null, ...errorContext(sessionError) };
    if (!data?.session?.access_token) return { status: 'permission', code: null };
    // Inspect API documentation only; never invoke the scheduling routine.
    const response = await fetchRequest(`${url.replace(/\/$/, '')}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: ['Bearer', data.session.access_token].join(' '),
        'Accept-Profile': 'public',
        Accept: 'application/openapi+json',
      },
    });
    const document = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) return { status: 'permission', code: document?.code || null, ...errorContext(document) };
    if (!response.ok) return { status: classifyError(document || {}, false), code: document?.code || null, ...errorContext(document) };
    if (!(document?.swagger === '2.0' || /^3\./.test(document?.openapi || ''))
      || !document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) {
      return { status: 'unknown', code: null };
    }
    const operation = document.paths['/rpc/today_v2_update_day_schedule']?.post;
    // Documentation omits installed functions without the caller's EXECUTE grant.
    if (!operation) return {
      status: 'unknown', code: 'OPENAPI_RPC_UNAVAILABLE',
      message: 'Day-schedule RPC is absent from API documentation; EXECUTE permissions may hide an installed function.',
    };
    let schema = operation.parameters?.find((parameter) => parameter.in === 'body')?.schema
      || operation.requestBody?.content?.['application/json']?.schema;
    for (let depth = 0; schema?.$ref && depth < 8; depth += 1) {
      if (!schema.$ref.startsWith('#/')) return { status: 'unknown', code: null };
      schema = schema.$ref.slice(2).split('/').reduce((value, key) => {
        const decoded = key.replace(/~1/g, '/').replace(/~0/g, '~');
        return value && Object.hasOwn(value, decoded) ? value[decoded] : undefined;
      }, document);
    }
    if (!schema?.properties || schema.$ref) return { status: 'unknown', code: null };
    const expected = ['p_target_local_date', 'p_timezone_name', 'p_source_type', 'p_source_id', 'p_starts_at', 'p_ends_at'];
    return expected.every((name) => Object.hasOwn(schema.properties, name))
      && (!Array.isArray(schema.required) || schema.required.every((name) => expected.includes(name)))
      ? { status: 'available', code: null }
      : { status: 'missing', code: 'OPENAPI_RPC_SIGNATURE_MISSING' };
  } catch (error) {
    return { status: classifyError(error, false), code: error?.code || null, ...errorContext(error) };
  }
}

export async function diagnoseTodayV2Schema(client = supabase, options = {}) {
  const checks = await Promise.all([...TODAY_V2_SCHEMA_PROBES.map(async (check) => {
    let error;
    try {
      ({ error } = await client.from(check.table).select(check.columns).limit(0));
    } catch (caught) {
      error = caught;
    }
    const status = error ? classifyError(error) : 'available';
    const code = error?.code || null;
    const migration = ['42P01', 'PGRST205'].includes(error?.code) ? check.tableMigration : check.migration;
    return { ...check, migration, status, code, ...errorContext(error) };
  }), probeDayScheduleMetadata(client, options).then((result) => ({
    rpc: 'today_v2_update_day_schedule', migration: daySchedule, ...result,
  }))]);
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
