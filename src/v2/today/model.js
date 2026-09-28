import { localDateStr } from '../../lib/dateUtils';
import { splitCommitmentIntoTasks } from '../../shared/commitmentFragmentation';
import {
  TODAY_V2_COMMITMENT_STATES,
  TODAY_V2_PARSER_VERSION,
  TODAY_V2_RESPONSE_TYPES,
} from './types';

export function getTodayV2TimezoneName() {
  return Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'UTC';
}

export function getTodayV2DateContext() {
  return {
    timezoneName: getTodayV2TimezoneName(),
    yesterdayLocalDate: localDateStr(-1),
    todayLocalDate: localDateStr(0),
    tomorrowLocalDate: localDateStr(1),
  };
}

export function getTodayV2WeekdayIndex(localDate) {
  const [year, month, day] = String(localDate || '')
    .split('-')
    .map((value) => Number(value));

  if (!year || !month || !day) return new Date().getDay();
  return new Date(year, month - 1, day).getDay();
}

export function validateTodayV2Weekdays(weekdays) {
  const normalized = [...new Set((Array.isArray(weekdays) ? weekdays : []).map((value) => Number(value)))]
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    .sort((left, right) => left - right);

  return normalized;
}

export function normalizeTodayV2Text(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTodayV2CommitmentDrafts(rawPlanText, parserVersion = TODAY_V2_PARSER_VERSION) {
  return splitCommitmentIntoTasks(rawPlanText).map((fragmentText, fragmentOrder) => ({
    fragmentText,
    normalizedFragmentText: normalizeTodayV2Text(fragmentText),
    fragmentOrder,
    parserVersion,
    completionState: TODAY_V2_COMMITMENT_STATES.UNANSWERED,
  }));
}

export function coerceTodayV2EditableFragments(rawPlanText, editableFragments) {
  const normalized = (Array.isArray(editableFragments) ? editableFragments : [])
    .map((value) => normalizeTodayV2Text(value))
    .filter(Boolean);

  if (normalized.length > 0) return normalized;
  return buildTodayV2CommitmentDrafts(rawPlanText).map((draft) => draft.normalizedFragmentText);
}

export function isTodayV2HabitScheduledForDate(habitDefinition, localDate) {
  if (!habitDefinition || habitDefinition.is_archived) return false;
  const schedule = validateTodayV2Weekdays(habitDefinition.schedule_weekdays);
  return schedule.includes(getTodayV2WeekdayIndex(localDate));
}

export function buildTodayV2OccurrenceSnapshots(habitDefinitions, localDate, timezoneName) {
  return (Array.isArray(habitDefinitions) ? habitDefinitions : [])
    .filter((habitDefinition) => isTodayV2HabitScheduledForDate(habitDefinition, localDate))
    .sort((left, right) => (left.display_order ?? 0) - (right.display_order ?? 0))
    .map((habitDefinition) => ({
      habit_definition_id: habitDefinition.id,
      local_date: localDate,
      timezone_name: timezoneName,
      scheduled_weekday: getTodayV2WeekdayIndex(localDate),
      snapshot_name: habitDefinition.name,
      snapshot_response_type: habitDefinition.response_type,
      snapshot_unit: habitDefinition.unit || null,
      snapshot_display_order: habitDefinition.display_order ?? 0,
      boolean_response: null,
      numeric_response: null,
      answered_at: null,
    }));
}

export function getTodayV2BooleanAnswer(value, answeredAt) {
  if (!answeredAt && value == null) return TODAY_V2_COMMITMENT_STATES.UNANSWERED;
  return value ? 'yes' : 'no';
}

export function getTodayV2CommitmentStateLabel(completionState) {
  switch (completionState) {
    case TODAY_V2_COMMITMENT_STATES.KEPT:
      return 'Kept';
    case TODAY_V2_COMMITMENT_STATES.NOT_KEPT:
      return 'Not kept';
    default:
      return 'Unanswered';
  }
}

export function buildTodayV2HabitResponsePatch(responseType, value) {
  if (responseType === TODAY_V2_RESPONSE_TYPES.NUMBER) {
    return {
      boolean_response: null,
      numeric_response: Number.isFinite(value) ? value : null,
      answered_at: Number.isFinite(value) ? new Date().toISOString() : null,
    };
  }

  if (value == null) {
    return {
      boolean_response: null,
      numeric_response: null,
      answered_at: null,
    };
  }

  return {
    boolean_response: Boolean(value),
    numeric_response: null,
    answered_at: new Date().toISOString(),
  };
}
