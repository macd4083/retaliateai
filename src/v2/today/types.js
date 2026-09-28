export const TODAY_V2_RESPONSE_TYPES = Object.freeze({
  BOOLEAN: 'boolean',
  NUMBER: 'number',
});

export const TODAY_V2_COMMITMENT_STATES = Object.freeze({
  UNANSWERED: 'unanswered',
  KEPT: 'kept',
  NOT_KEPT: 'not_kept',
});

export const TODAY_V2_PARSER_VERSION = 'commitment-fragmentation-v2';

export const TODAY_V2_WEEKDAY_LABELS = Object.freeze(['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa']);

export const TODAY_V2_TABLES = Object.freeze({
  DAILY_REVIEWS: 'today_v2_daily_reviews',
  PLAN_INPUTS: 'today_v2_plan_inputs',
  COMMITMENT_FRAGMENTS: 'today_v2_commitment_fragments',
  HABIT_DEFINITIONS: 'today_v2_habit_definitions',
  HABIT_OCCURRENCES: 'today_v2_habit_occurrences',
});

export const TODAY_V2_RPCS = Object.freeze({
  SEED_DEFAULT_HABITS: 'today_v2_seed_default_habits_for_user',
  ENSURE_HABIT_OCCURRENCES: 'today_v2_ensure_habit_occurrences_for_date',
  REPLACE_PLAN: 'today_v2_replace_plan_for_date',
});

export const TODAY_V2_DEFAULT_HABIT_SEEDS = Object.freeze([
  {
    seed_key: 'sleep',
    name: 'Sleep',
    response_type: TODAY_V2_RESPONSE_TYPES.NUMBER,
    unit: 'hours',
    schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
    display_order: 0,
  },
  {
    seed_key: 'exercise_movement',
    name: 'Exercise/movement',
    response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN,
    unit: null,
    schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
    display_order: 1,
  },
  {
    seed_key: 'focused_work',
    name: 'Focused work',
    response_type: TODAY_V2_RESPONSE_TYPES.NUMBER,
    unit: 'minutes',
    schedule_weekdays: [0, 1, 2, 3, 4, 5, 6],
    display_order: 2,
  },
]);

export const TODAY_V2_FORBIDDEN_PERSISTENCE_TOKENS = Object.freeze([
  'reflection_sessions',
  'reflection_messages',
  'follow_up_queue',
  'growth_markers',
  'goal_commitment_log',
  'seed_default_habits_for_user',
  'replace_v2_planned_actions',
  'v2_daily_reviews',
  'v2_planned_actions',
  'v2_follow_through_items',
  'v2_habit_definitions',
  'v2_habit_logs',
]);

/**
 * @typedef {typeof TODAY_V2_RESPONSE_TYPES[keyof typeof TODAY_V2_RESPONSE_TYPES]} TodayV2ResponseType
 */

/**
 * @typedef {typeof TODAY_V2_COMMITMENT_STATES[keyof typeof TODAY_V2_COMMITMENT_STATES]} TodayV2CommitmentState
 */
