import { supabase } from '../../lib/supabase/client';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import { loadSchedules, isMissingScheduleSchema } from './scheduling';
import { normalizeHabitRecurrence } from '../today/recurrence';
import {
  addDaysToLocalDate,
  buildTodayV2DraftStorageKey,
  buildTodayV2HabitResponsePatch,
  buildTodayV2HomeMetrics,
  coerceTodayV2EditableFragments,
  getLatestTodayV2Identity,
  getTodayV2DateContext,
  getTodayV2DefaultPath,
  normalizeTodayV2Text,
  normalizeTodayV2ActionStarts,
  validateTodayV2Weekdays,
} from '../today/model';
import {
  TODAY_V2_COMMITMENT_STATES,
  TODAY_V2_RPCS,
  TODAY_V2_TABLES,
} from '../today/types';

function buildTodayV2SeedDiagnostic(error) {
  if (!error) return null;

  const message = String(error.message || error.details || 'Could not initialize default habits.');
  const isMissingRpc = error.code === 'PGRST202' || /Could not find the function/i.test(message);

  return {
    code: error.code || 'TODAY_V2_SEED_FAILED',
    message: isMissingRpc
      ? 'Default habit seeding is temporarily unavailable. You can still add habits manually.'
      : 'Default habits could not be initialized. You can still add habits manually.',
    detail: message,
  };
}

export async function seedDefaultHabits(userId) {
  const { error } = await supabase.rpc(TODAY_V2_RPCS.SEED_DEFAULT_HABITS, { p_user_id: userId });
  return {
    error: error || null,
    diagnostic: buildTodayV2SeedDiagnostic(error || null),
  };
}

export async function ensureTodayV2DailyReview(userId, localDate, timezoneName) {
  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.DAILY_REVIEWS)
    .upsert(
      {
        user_id: userId,
        local_date: localDate,
        timezone_name: timezoneName,
      },
      { onConflict: 'user_id,local_date' }
    )
    .select('id, local_date, timezone_name, desired_direction, controllable_focus, updated_at, completed_at')
    .single();

  if (error) throw error;
  return data;
}

export async function ensureTodayV2HabitOccurrences(localDate, timezoneName) {
  const { error } = await supabase.rpc(TODAY_V2_RPCS.ENSURE_HABIT_OCCURRENCES, {
    p_local_date: localDate,
    p_timezone_name: timezoneName,
  });

  if (error) throw error;
}

export async function ensureTodayV2AutomaticHabitSchedules(startLocalDate, endLocalDate, timezoneName) {
  const { error } = await supabase.rpc('today_v2_seed_habit_schedules', {
    p_start_local_date: startLocalDate,
    p_end_local_date: endLocalDate,
    p_timezone_name: timezoneName,
  });
  if (error && !isMissingScheduleSchema(error)) throw error;
  return error ? { code: error.code, message: 'Automatic habit scheduling needs the recurrence migration.' } : null;
}

async function loadHabitDefinitions(userId) {
  const fields = 'id, seed_key, name, response_type, unit, schedule_weekdays, display_order, is_archived, archived_at, created_at, updated_at';
  const query = (selection) => supabase.from(TODAY_V2_TABLES.HABIT_DEFINITIONS)
    .select(selection).eq('user_id', userId)
    .order('display_order', { ascending: true }).order('created_at', { ascending: true });
  const result = await query(`${fields}, planning_mode, schedule_times`);
  if (['42703', 'PGRST204'].includes(result.error?.code)) {
    return { ...await query(fields), recurrenceAvailable: false };
  }
  return { ...result, recurrenceAvailable: true };
}

export async function loadTodayReviewState(userId, options = {}) {
  const dateContext = getTodayV2DateContext(options);
  const seedResult = await seedDefaultHabits(userId);

  const review = await ensureTodayV2DailyReview(
    userId,
    dateContext.todayLocalDate,
    dateContext.timezoneName
  );

  await ensureTodayV2HabitOccurrences(dateContext.todayLocalDate, dateContext.timezoneName);

  const [
    todayFragmentsResult,
    tomorrowPlanInputResult,
    todayPlanInputResult,
    previousReviewResult,
    tomorrowFragmentsResult,
    habitDefinitionsResult,
    habitOccurrencesResult,
  ] = await Promise.all([
    supabase
      .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
      .select('id, target_local_date, source_local_date, fragment_order, fragment_text, normalized_fragment_text, completion_state, answered_at, parser_version')
      .eq('user_id', userId)
      .eq('target_local_date', dateContext.todayLocalDate)
      .order('fragment_order', { ascending: true }),
    supabase
      .from(TODAY_V2_TABLES.PLAN_INPUTS)
      .select('id, raw_plan_text, first_five_minutes, target_local_date, source_local_date, timezone_name, parser_version, updated_at')
      .eq('user_id', userId)
      .eq('target_local_date', dateContext.tomorrowLocalDate)
      .maybeSingle(),
    supabase
      .from(TODAY_V2_TABLES.PLAN_INPUTS)
      .select('first_five_minutes')
      .eq('user_id', userId)
      .eq('target_local_date', dateContext.todayLocalDate)
      .maybeSingle(),
    supabase
      .from(TODAY_V2_TABLES.DAILY_REVIEWS)
      .select('desired_direction')
      .eq('user_id', userId)
      .lt('local_date', dateContext.todayLocalDate)
      .neq('desired_direction', '')
      .not('desired_direction', 'is', null)
      .order('local_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
      .select('id, target_local_date, source_local_date, fragment_order, fragment_text, normalized_fragment_text, completion_state, answered_at, parser_version')
      .eq('user_id', userId)
      .eq('target_local_date', dateContext.tomorrowLocalDate)
      .order('fragment_order', { ascending: true }),
    loadHabitDefinitions(userId),
    supabase
      .from(TODAY_V2_TABLES.HABIT_OCCURRENCES)
      .select('id, habit_definition_id, local_date, timezone_name, scheduled_weekday, snapshot_name, snapshot_response_type, snapshot_unit, snapshot_display_order, boolean_response, numeric_response, answered_at, created_at, updated_at')
      .eq('user_id', userId)
      .eq('local_date', dateContext.todayLocalDate)
      .order('snapshot_display_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (todayFragmentsResult.error) throw todayFragmentsResult.error;
  if (tomorrowPlanInputResult.error) throw tomorrowPlanInputResult.error;
  if (todayPlanInputResult.error) throw todayPlanInputResult.error;
  if (previousReviewResult.error) throw previousReviewResult.error;
  if (tomorrowFragmentsResult.error) throw tomorrowFragmentsResult.error;
  if (habitDefinitionsResult.error) throw habitDefinitionsResult.error;
  if (habitOccurrencesResult.error) throw habitOccurrencesResult.error;

  const recurrenceDiagnostic = ENABLE_TODAY_V2_SCHEDULER && habitDefinitionsResult.recurrenceAvailable
    ? await ensureTodayV2AutomaticHabitSchedules(
      dateContext.todayLocalDate, dateContext.tomorrowLocalDate, dateContext.timezoneName
    ) : null;

  return {
    ...dateContext,
    ...await loadSchedules(userId, dateContext.todayLocalDate, dateContext.tomorrowLocalDate, dateContext.timezoneName),
    review,
    routeTarget: getTodayV2DefaultPath(review),
    draftStorageKey: buildTodayV2DraftStorageKey(userId, dateContext.todayLocalDate),
    seedDiagnostic: seedResult.diagnostic,
    recurrenceDiagnostic: recurrenceDiagnostic || (habitDefinitionsResult.recurrenceAvailable ? null : {
      code: 'HABIT_RECURRENCE_SCHEMA_MISSING', message: 'Automatic habit scheduling needs the recurrence migration.',
    }),
    followThroughItems: todayFragmentsResult.data || [],
    tomorrowPlanInput: tomorrowPlanInputResult.data?.raw_plan_text || '',
    tomorrowPlanMeta: tomorrowPlanInputResult.data || null,
    firstFiveMinutes: tomorrowPlanInputResult.data?.first_five_minutes || '',
    todayFirstFiveMinutes: todayPlanInputResult.data?.first_five_minutes || '',
    previousDesiredDirection: previousReviewResult.data?.desired_direction || '',
    tomorrowFragments: tomorrowFragmentsResult.data || [],
    habitDefinitions: (habitDefinitionsResult.data || []).filter((habitDefinition) => !habitDefinition.is_archived),
    habitOccurrences: habitOccurrencesResult.data || [],
  };
}

export async function loadTodayV2HomeState(userId, options = {}) {
  const current = await loadTodayReviewState(userId, options);
  const civilScheduleLocalDate = getTodayV2DateContext({
    ...options, timezoneName: current.timezoneName, dayBoundaryHour: 0,
  }).todayLocalDate;
  const last30Start = addDaysToLocalDate(current.todayLocalDate, -29);
  const last7Start = addDaysToLocalDate(current.todayLocalDate, -6);

  const [reviewsResult, fragmentsResult, habitOccurrencesResult] = await Promise.all([
    supabase
      .from(TODAY_V2_TABLES.DAILY_REVIEWS)
      .select('local_date, desired_direction, controllable_focus, completed_at')
      .eq('user_id', userId)
      .gte('local_date', last30Start)
      .lte('local_date', current.todayLocalDate)
      .order('local_date', { ascending: false }),
    supabase
      .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
      .select('target_local_date, completion_state')
      .eq('user_id', userId)
      .gte('target_local_date', last30Start)
      .lte('target_local_date', current.todayLocalDate),
    supabase
      .from(TODAY_V2_TABLES.HABIT_OCCURRENCES)
      .select('local_date, snapshot_name, snapshot_response_type, snapshot_unit, boolean_response, numeric_response, answered_at')
      .eq('user_id', userId)
      .gte('local_date', last7Start)
      .lte('local_date', current.todayLocalDate),
  ]);

  if (reviewsResult.error) throw reviewsResult.error;
  if (fragmentsResult.error) throw fragmentsResult.error;
  if (habitOccurrencesResult.error) throw habitOccurrencesResult.error;

  const reviewHistory = reviewsResult.data || [];

  return {
    ...current,
    civilScheduleLocalDate,
    civilSchedules: civilScheduleLocalDate === current.todayLocalDate
      ? current.todaySchedules : current.tomorrowSchedules,
    latestDesiredDirection: getLatestTodayV2Identity(reviewHistory, current.review?.desired_direction || ''),
    metrics: buildTodayV2HomeMetrics({
      reviews: reviewHistory,
      fragments: fragmentsResult.data || [],
      habitOccurrences: habitOccurrencesResult.data || [],
      todayLocalDate: current.todayLocalDate,
    }),
  };
}

export async function getTodayV2RouteTarget(userId, options = {}) {
  const dateContext = getTodayV2DateContext(options);
  const review = await ensureTodayV2DailyReview(userId, dateContext.todayLocalDate, dateContext.timezoneName);
  return getTodayV2DefaultPath(review);
}

export async function setFollowThroughCompletion(fragmentId, completionState) {
  const nextState = completionState || TODAY_V2_COMMITMENT_STATES.UNANSWERED;
  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
    .update({
      completion_state: nextState,
      answered_at: nextState === TODAY_V2_COMMITMENT_STATES.UNANSWERED ? null : new Date().toISOString(),
    })
    .eq('id', fragmentId)
    .select('id, target_local_date, source_local_date, fragment_order, fragment_text, normalized_fragment_text, completion_state, answered_at, parser_version')
    .single();

  if (error) throw error;
  return data;
}

export async function addManualFollowThroughItem(userId, localDate, actionText, actionOrder, timezoneName) {
  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
    .insert({
      user_id: userId,
      plan_input_id: null,
      source_local_date: localDate,
      target_local_date: localDate,
      timezone_name: timezoneName,
      fragment_order: actionOrder,
      fragment_text: actionText,
      normalized_fragment_text: normalizeTodayV2Text(actionText),
      parser_version: 'manual_follow_through_same_day',
      completion_state: TODAY_V2_COMMITMENT_STATES.UNANSWERED,
    })
    .select('id, target_local_date, source_local_date, fragment_order, fragment_text, normalized_fragment_text, completion_state, answered_at, parser_version')
    .single();

  if (error) throw error;
  return data;
}

export async function upsertHabitDefinition(userId, habit) {
  const payload = {
    user_id: userId,
    name: String(habit.name || '').trim(),
    response_type: habit.response_type,
    unit: habit.response_type === 'number' ? String(habit.unit || '').trim() || null : null,
    schedule_weekdays: validateTodayV2Weekdays(habit.schedule_weekdays),
    ...normalizeHabitRecurrence(habit),
    display_order: Number.isInteger(habit.display_order) ? habit.display_order : 0,
    is_archived: false,
    archived_at: null,
  };

  if (habit.id) {
    const { error } = await supabase
      .from(TODAY_V2_TABLES.HABIT_DEFINITIONS)
      .update(payload)
      .eq('id', habit.id)
      .eq('user_id', userId);

    if (error) {
      if (error.code === '23505') {
        throw new Error('A habit with this name already exists.');
      }
      throw error;
    }

    return habit.id;
  }

  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.HABIT_DEFINITIONS)
    .insert({
      ...payload,
      seed_key: habit.seed_key || null,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A habit with this name already exists.');
    }
    throw error;
  }

  return data.id;
}

export async function archiveHabit(userId, habitId) {
  const { error } = await supabase
    .from(TODAY_V2_TABLES.HABIT_DEFINITIONS)
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', habitId);

  if (error) throw error;
}

export async function upsertHabitLog(occurrenceId, habitType, value) {
  const patch = buildTodayV2HabitResponsePatch(habitType, value);
  if (patch.answered_at !== null) {
    patch.answered_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.HABIT_OCCURRENCES)
    .update(patch)
    .eq('id', occurrenceId)
    .select('id, habit_definition_id, local_date, timezone_name, scheduled_weekday, snapshot_name, snapshot_response_type, snapshot_unit, snapshot_display_order, boolean_response, numeric_response, answered_at, created_at, updated_at')
    .single();

  if (error) throw error;
  return data;
}

export async function updateDesiredDirection(reviewId, desiredDirection) {
  const normalizedDirection = String(desiredDirection || '').trim();
  const { error } = await supabase
    .from(TODAY_V2_TABLES.DAILY_REVIEWS)
    .update({ desired_direction: normalizedDirection })
    .eq('id', reviewId);

  if (error) throw error;
}

export async function updateControllableFocus(reviewId, controllableFocus) {
  const normalizedFocus = String(controllableFocus || '').trim();
  const { error } = await supabase
    .from(TODAY_V2_TABLES.DAILY_REVIEWS)
    .update({ controllable_focus: normalizedFocus || null })
    .eq('id', reviewId);

  if (error) throw error;
}

export async function completeTodayV2Review(reviewId) {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.DAILY_REVIEWS)
    .update({ completed_at: completedAt })
    .eq('id', reviewId)
    .select('id, local_date, timezone_name, desired_direction, controllable_focus, updated_at, completed_at')
    .single();

  if (error) throw error;
  return data;
}

export async function reopenTodayV2Review(reviewId) {
  const { data, error } = await supabase
    .from(TODAY_V2_TABLES.DAILY_REVIEWS)
    .update({ completed_at: null })
    .eq('id', reviewId)
    .select('id, local_date, timezone_name, desired_direction, controllable_focus, updated_at, completed_at')
    .single();

  if (error) throw error;
  return data;
}

export async function replaceTomorrowActions({
  targetLocalDate,
  sourceLocalDate,
  timezoneName,
  rawPlanText,
  actionTexts,
  firstFiveMinutes = '',
  fragmentIds = [],
  scheduleAvailable = false,
  userId,
  explicitActions = false,
}) {
  const normalizedRawText = String(rawPlanText || '').trim();
  const fragments = coerceTodayV2EditableFragments(explicitActions ? '' : normalizedRawText, actionTexts);
  const stable = ENABLE_TODAY_V2_SCHEDULER && scheduleAvailable;
  const { data, error } = await supabase.rpc(stable ? 'today_v2_replace_plan_stable' : TODAY_V2_RPCS.REPLACE_PLAN, {
    p_target_local_date: targetLocalDate,
    p_source_local_date: sourceLocalDate,
    p_timezone_name: timezoneName,
    p_raw_plan_text: normalizedRawText,
    p_fragment_texts: fragments,
    p_first_five_minutes: normalizeTodayV2ActionStarts(firstFiveMinutes) || null,
    ...(stable ? { p_fragment_ids: fragments.map((_, index) => (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fragmentIds[index] || '')
        ? fragmentIds[index] : null
    )) } : {}),
  });

  if (stable && isMissingScheduleSchema(error)) {
    const saved = await replaceTomorrowActions({
      targetLocalDate, sourceLocalDate, timezoneName, rawPlanText, actionTexts, firstFiveMinutes,
      scheduleAvailable: false, userId,
      explicitActions,
    });
    return { ...saved, scheduleAvailable: false, scheduleDiagnostic: { code: error.code, message: error.message } };
  }
  if (error) throw error;
  let savedFragments = stable ? [...(data || [])].sort((a, b) => a.fragment_order - b.fragment_order) : [];
  if (!stable) {
    let query = supabase.from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS).select('*')
      .eq('target_local_date', targetLocalDate).order('fragment_order', { ascending: true });
    if (userId) query = query.eq('user_id', userId);
    const result = await query;
    if (result.error) throw result.error;
    savedFragments = result.data || [];
  }
  return {
    rawPlanText: normalizedRawText,
    fragments,
    savedFragments,
  };
}

export function buildEmptyHabitDefinition(existingHabits = []) {
  return {
    id: null,
    name: '',
    response_type: 'boolean',
    unit: '',
    schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
    planning_mode: 'manual',
    schedule_times: {},
    display_order: existingHabits.length,
  };
}

export { TODAY_V2_COMMITMENT_STATES };
