import { supabase } from '../../lib/supabase/client';
import {
  buildTodayV2HabitResponsePatch,
  coerceTodayV2EditableFragments,
  getTodayV2DateContext,
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
    .select('id, local_date, timezone_name, desired_direction')
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

export async function loadTodayReviewState(userId) {
  const dateContext = getTodayV2DateContext();
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
      .select('id, raw_plan_text, target_local_date, source_local_date, timezone_name, parser_version')
      .eq('user_id', userId)
      .eq('target_local_date', dateContext.tomorrowLocalDate)
      .maybeSingle(),
    supabase
      .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
      .select('id, target_local_date, source_local_date, fragment_order, fragment_text, normalized_fragment_text, completion_state, answered_at, parser_version')
      .eq('user_id', userId)
      .eq('target_local_date', dateContext.tomorrowLocalDate)
      .order('fragment_order', { ascending: true }),
    supabase
      .from(TODAY_V2_TABLES.HABIT_DEFINITIONS)
      .select('id, seed_key, name, response_type, unit, schedule_weekdays, display_order, is_archived, archived_at, created_at, updated_at')
      .eq('user_id', userId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true }),
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
  if (tomorrowFragmentsResult.error) throw tomorrowFragmentsResult.error;
  if (habitDefinitionsResult.error) throw habitDefinitionsResult.error;
  if (habitOccurrencesResult.error) throw habitOccurrencesResult.error;

  return {
    ...dateContext,
    review,
    seedDiagnostic: seedResult.diagnostic,
    followThroughItems: todayFragmentsResult.data || [],
    tomorrowPlanInput: tomorrowPlanInputResult.data?.raw_plan_text || '',
    tomorrowPlanMeta: tomorrowPlanInputResult.data || null,
    tomorrowFragments: tomorrowFragmentsResult.data || [],
    habitDefinitions: (habitDefinitionsResult.data || []).filter((habitDefinition) => !habitDefinition.is_archived),
    habitOccurrences: habitOccurrencesResult.data || [],
  };
}

export async function setFollowThroughCompletion(fragmentId, completionState) {
  const nextState = completionState || TODAY_V2_COMMITMENT_STATES.UNANSWERED;
  const { error } = await supabase
    .from(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS)
    .update({
      completion_state: nextState,
      answered_at: nextState === TODAY_V2_COMMITMENT_STATES.UNANSWERED ? null : new Date().toISOString(),
    })
    .eq('id', fragmentId);

  if (error) throw error;
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
      normalized_fragment_text: actionText,
      parser_version: 'manual_follow_through',
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

export async function archiveHabit(habitId) {
  const { error } = await supabase
    .from(TODAY_V2_TABLES.HABIT_DEFINITIONS)
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    })
    .eq('id', habitId);

  if (error) throw error;
}

export async function upsertHabitLog(occurrenceId, habitType, value) {
  const { error } = await supabase
    .from(TODAY_V2_TABLES.HABIT_OCCURRENCES)
    .update(buildTodayV2HabitResponsePatch(habitType, value))
    .eq('id', occurrenceId);

  if (error) throw error;
}

export async function updateDesiredDirection(reviewId, desiredDirection) {
  const { error } = await supabase
    .from(TODAY_V2_TABLES.DAILY_REVIEWS)
    .update({ desired_direction: desiredDirection })
    .eq('id', reviewId);

  if (error) throw error;
}

export async function replaceTomorrowActions({ targetLocalDate, sourceLocalDate, timezoneName, rawPlanText, actionTexts }) {
  const normalizedRawText = String(rawPlanText || '').trim();
  const fragments = normalizedRawText ? coerceTodayV2EditableFragments(normalizedRawText, actionTexts) : [];
  const { error } = await supabase.rpc(TODAY_V2_RPCS.REPLACE_PLAN, {
    p_target_local_date: targetLocalDate,
    p_source_local_date: sourceLocalDate,
    p_timezone_name: timezoneName,
    p_raw_plan_text: normalizedRawText,
    p_fragment_texts: fragments,
  });

  if (error) throw error;
}

export function buildEmptyHabitDefinition(existingHabits = []) {
  return {
    id: null,
    name: '',
    response_type: 'boolean',
    unit: '',
    schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
    display_order: existingHabits.length,
  };
}

export { TODAY_V2_COMMITMENT_STATES };
