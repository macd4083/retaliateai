import { splitCommitmentIntoTasks } from '../../shared/commitmentFragmentation';
import {
  TODAY_V2_COMMITMENT_STATES,
  TODAY_V2_PARSER_VERSION,
  TODAY_V2_RESPONSE_TYPES,
} from './types';

export const TODAY_V2_DEFAULT_DAY_BOUNDARY_HOUR = 4;

export function getTodayV2TimezoneName() {
  return Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'UTC';
}

function coerceTodayV2BoundaryHour(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null;
  return parsed;
}

export function getTodayV2DayBoundaryHour() {
  const storageOverride = typeof window !== 'undefined'
    ? coerceTodayV2BoundaryHour(window.localStorage.getItem('today_v2_day_boundary_hour'))
    : null;
  if (storageOverride != null) return storageOverride;

  const envOverride = coerceTodayV2BoundaryHour(import.meta?.env?.VITE_TODAY_V2_DAY_BOUNDARY_HOUR);
  return envOverride ?? TODAY_V2_DEFAULT_DAY_BOUNDARY_HOUR;
}

export function formatTodayV2LocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToLocalDate(localDate, offsetDays) {
  const [year, month, day] = String(localDate || '')
    .split('-')
    .map((value) => Number(value));

  if (!year || !month || !day) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + offsetDays);
    return formatTodayV2LocalDate(fallback);
  }

  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + offsetDays);
  return formatTodayV2LocalDate(next);
}

export function getTodayV2DateContext(options = {}) {
  const now = options.now instanceof Date ? new Date(options.now) : new Date();
  const boundaryHour = coerceTodayV2BoundaryHour(options.dayBoundaryHour) ?? getTodayV2DayBoundaryHour();
  const timezoneName = options.timezoneName || getTodayV2TimezoneName();
  const reviewAnchor = new Date(now);

  if (reviewAnchor.getHours() < boundaryHour) {
    reviewAnchor.setDate(reviewAnchor.getDate() - 1);
  }

  const todayLocalDate = formatTodayV2LocalDate(reviewAnchor);

  return {
    timezoneName,
    dayBoundaryHour: boundaryHour,
    yesterdayLocalDate: addDaysToLocalDate(todayLocalDate, -1),
    todayLocalDate,
    tomorrowLocalDate: addDaysToLocalDate(todayLocalDate, 1),
  };
}

export function getTodayV2NextBoundaryDate(options = {}) {
  const now = options.now instanceof Date ? new Date(options.now) : new Date();
  const boundaryHour = coerceTodayV2BoundaryHour(options.dayBoundaryHour) ?? getTodayV2DayBoundaryHour();
  const nextBoundary = new Date(now);

  nextBoundary.setHours(boundaryHour, 0, 0, 0);
  if (nextBoundary <= now) {
    nextBoundary.setDate(nextBoundary.getDate() + 1);
  }

  return nextBoundary;
}

export function getTodayV2MsUntilNextBoundary(options = {}) {
  const now = options.now instanceof Date ? new Date(options.now) : new Date();
  return Math.max(0, getTodayV2NextBoundaryDate(options).getTime() - now.getTime());
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

export function buildTodayV2DraftStorageKey(userId, localDate) {
  return `today-v2-draft:${userId || 'anonymous'}:${localDate || 'unknown'}`;
}

export function getTodayV2CompletionGate({ followThroughItems = [], habitOccurrences = [], tomorrowActions = [] }) {
  const normalizedTomorrowActions = coerceTodayV2EditableFragments('', tomorrowActions);
  const followThroughSatisfied = followThroughItems.every((item) => item.completion_state !== TODAY_V2_COMMITMENT_STATES.UNANSWERED);
  const unansweredHabits = habitOccurrences.filter((occurrence) => {
    if (occurrence.snapshot_response_type === TODAY_V2_RESPONSE_TYPES.NUMBER) {
      return !occurrence.answered_at && occurrence.numeric_response == null;
    }

    return !occurrence.answered_at && occurrence.boolean_response == null;
  });

  return {
    canComplete: normalizedTomorrowActions.length > 0 && followThroughSatisfied,
    followThroughSatisfied,
    unansweredHabitsCount: unansweredHabits.length,
    hasTomorrowActions: normalizedTomorrowActions.length > 0,
  };
}

function sortLocalDatesDescending(values) {
  return [...values].sort((left, right) => right.localeCompare(left));
}

function buildCommitmentRate(fragments) {
  const answered = fragments.filter((fragment) => fragment.completion_state !== TODAY_V2_COMMITMENT_STATES.UNANSWERED);
  const kept = answered.filter((fragment) => fragment.completion_state === TODAY_V2_COMMITMENT_STATES.KEPT);

  return {
    kept: kept.length,
    answered: answered.length,
    rate: answered.length > 0 ? kept.length / answered.length : null,
  };
}

export function getLatestTodayV2Identity(reviews = [], fallback = '') {
  return [...(Array.isArray(reviews) ? reviews : [])]
    .sort((left, right) => String(right?.local_date || '').localeCompare(String(left?.local_date || '')))
    .map((review) => normalizeTodayV2Text(review?.desired_direction))
    .find(Boolean) || normalizeTodayV2Text(fallback);
}

export function buildTodayV2HomeMetrics({ reviews = [], fragments = [], habitOccurrences = [], todayLocalDate }) {
  const completedDates = sortLocalDatesDescending(
    (Array.isArray(reviews) ? reviews : [])
      .filter((review) => review?.completed_at)
      .map((review) => review.local_date)
  );

  let reviewStreak = 0;
  let cursorDate = completedDates[0] || null;
  while (cursorDate && completedDates.includes(cursorDate)) {
    reviewStreak += 1;
    cursorDate = addDaysToLocalDate(cursorDate, -1);
  }

  const last7Start = addDaysToLocalDate(todayLocalDate, -6);
  const last30Start = addDaysToLocalDate(todayLocalDate, -29);
  const fragmentsLast7 = (Array.isArray(fragments) ? fragments : []).filter((fragment) => fragment.target_local_date >= last7Start && fragment.target_local_date <= todayLocalDate);
  const fragmentsLast30 = (Array.isArray(fragments) ? fragments : []).filter((fragment) => fragment.target_local_date >= last30Start && fragment.target_local_date <= todayLocalDate);

  const perHabitMap = new Map();
  for (const occurrence of Array.isArray(habitOccurrences) ? habitOccurrences : []) {
    const key = `${occurrence.snapshot_name}::${occurrence.snapshot_response_type}`;
    if (!perHabitMap.has(key)) {
      perHabitMap.set(key, {
        name: occurrence.snapshot_name,
        responseType: occurrence.snapshot_response_type,
        unit: occurrence.snapshot_unit || null,
        answered: 0,
        kept: 0,
        scheduled: 0,
      });
    }

    const stats = perHabitMap.get(key);
    stats.scheduled += 1;
    if (occurrence.snapshot_response_type === TODAY_V2_RESPONSE_TYPES.NUMBER) {
      if (occurrence.numeric_response != null || occurrence.answered_at) {
        stats.answered += 1;
      }
    } else if (occurrence.boolean_response != null || occurrence.answered_at) {
      stats.answered += 1;
      if (occurrence.boolean_response === true) {
        stats.kept += 1;
      }
    }
  }

  const perHabitRates = [...perHabitMap.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((stats) => ({
      ...stats,
      rate: stats.responseType === TODAY_V2_RESPONSE_TYPES.BOOLEAN
        ? (stats.answered > 0 ? stats.kept / stats.answered : null)
        : (stats.scheduled > 0 ? stats.answered / stats.scheduled : null),
    }));

  const completedDateSet = new Set(completedDates);
  const sevenDayDots = Array.from({ length: 7 }, (_, index) => {
    const localDate = addDaysToLocalDate(todayLocalDate, index - 6);
    return {
      localDate,
      completed: completedDateSet.has(localDate),
    };
  });

  return {
    reviewStreak,
    sevenDayCommitmentRate: buildCommitmentRate(fragmentsLast7),
    thirtyDayCommitmentRate: buildCommitmentRate(fragmentsLast30),
    perHabitRates,
    sevenDayDots,
  };
}

export function getTodayV2DefaultPath(review) {
  return review?.completed_at ? '/home' : '/today';
}
