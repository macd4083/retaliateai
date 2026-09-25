import { supabase } from './client';
import { localDateStr } from '../dateUtils';

const DEFAULT_HABITS = [
  {
    name: 'Sleep',
    input_type: 'number',
    unit: 'hours',
    scheduled_days: [1, 2, 3, 4, 5, 6, 0],
    display_order: 0,
  },
  {
    name: 'Exercise / movement',
    input_type: 'boolean',
    unit: null,
    scheduled_days: [1, 2, 3, 4, 5, 6, 0],
    display_order: 1,
  },
  {
    name: 'Focused work',
    input_type: 'duration',
    unit: 'minutes',
    scheduled_days: [1, 2, 3, 4, 5, 6, 0],
    display_order: 2,
  },
  {
    name: 'Personal habit',
    input_type: 'boolean',
    unit: null,
    scheduled_days: [1, 2, 3, 4, 5, 6, 0],
    display_order: 3,
  },
];

export function weekdayIndexForDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12).getDay();
}

export function offsetDateStr(dateStr, offsetDays) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function ensureDefaultHabits(userId) {
  const { data, error } = await supabase
    .from('user_habits')
    .select('id')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .limit(1);

  if (error) throw error;
  if (data && data.length > 0) return;

  const rows = DEFAULT_HABITS.map((habit) => ({ ...habit, user_id: userId }));
  const { error: insertError } = await supabase.from('user_habits').insert(rows);
  if (insertError) throw insertError;
}

export const dailyWorkflow = {
  async loadReviewData(userId, reviewDate = localDateStr()) {
    await ensureDefaultHabits(userId);

    const weekday = weekdayIndexForDate(reviewDate);
    const yesterday = offsetDateStr(reviewDate, -1);

    const [{ data: planActions, error: planError }, { data: actionReviews, error: reviewError }, { data: habits, error: habitsError }, { data: checkins, error: checkinsError }] = await Promise.all([
      supabase
        .from('daily_plan_actions')
        .select('id, action_text, completion_measure, minimum_version, stretch_version, is_primary, display_order')
        .eq('user_id', userId)
        .eq('plan_date', reviewDate)
        .eq('is_published', true)
        .order('is_primary', { ascending: false })
        .order('display_order', { ascending: true }),
      supabase
        .from('daily_action_reviews')
        .select('id, plan_action_id, action_text, completion_measure, outcome, is_primary, display_order')
        .eq('user_id', userId)
        .eq('review_date', reviewDate)
        .order('is_primary', { ascending: false })
        .order('display_order', { ascending: true }),
      supabase
        .from('user_habits')
        .select('id, name, input_type, unit, scheduled_days, display_order')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .contains('scheduled_days', [weekday])
        .order('display_order', { ascending: true }),
      supabase
        .from('habit_checkins')
        .select('habit_id, value_boolean, value_number')
        .eq('user_id', userId)
        .eq('checkin_date', reviewDate),
    ]);

    if (planError) throw planError;
    if (reviewError) throw reviewError;
    if (habitsError) throw habitsError;
    if (checkinsError) throw checkinsError;

    const { data: yesterdaySession } = await supabase
      .from('reflection_sessions')
      .select('tomorrow_commitment')
      .eq('user_id', userId)
      .eq('date', yesterday)
      .maybeSingle();

    return {
      planActions: planActions || [],
      actionReviews: actionReviews || [],
      habits: habits || [],
      checkins: checkins || [],
      yesterdayCommitment: yesterdaySession?.tomorrow_commitment || null,
    };
  },

  async saveActionReviews({ userId, sessionId, reviewDate, rows }) {
    const { error: deleteError } = await supabase
      .from('daily_action_reviews')
      .delete()
      .eq('user_id', userId)
      .eq('review_date', reviewDate);
    if (deleteError) throw deleteError;

    if (!rows.length) return;

    const payload = rows.map((row, index) => ({
      user_id: userId,
      session_id: sessionId,
      review_date: reviewDate,
      plan_action_id: row.plan_action_id || null,
      action_text: row.action_text,
      completion_measure: row.completion_measure || null,
      outcome: row.outcome,
      is_primary: Boolean(row.is_primary),
      display_order: index,
    }));

    const { error: insertError } = await supabase.from('daily_action_reviews').insert(payload);
    if (insertError) throw insertError;
  },

  async saveHabitCheckins({ userId, reviewDate, rows }) {
    if (!rows.length) return;

    const payload = rows.map((row) => ({
      user_id: userId,
      habit_id: row.habit_id,
      checkin_date: reviewDate,
      value_boolean: row.value_boolean ?? null,
      value_number: row.value_number ?? null,
    }));

    const { error } = await supabase
      .from('habit_checkins')
      .upsert(payload, { onConflict: 'user_id,habit_id,checkin_date' });

    if (error) throw error;
  },

  async saveHabit(userId, habit) {
    const payload = {
      user_id: userId,
      name: habit.name,
      input_type: habit.input_type,
      unit: habit.unit || null,
      scheduled_days: habit.scheduled_days,
      display_order: habit.display_order ?? 0,
    };

    if (habit.id) {
      const { data, error } = await supabase
        .from('user_habits')
        .update(payload)
        .eq('id', habit.id)
        .eq('user_id', userId)
        .select('id, name, input_type, unit, scheduled_days, display_order')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('user_habits')
      .insert(payload)
      .select('id, name, input_type, unit, scheduled_days, display_order')
      .single();
    if (error) throw error;
    return data;
  },

  async archiveHabit(userId, habitId) {
    const { error } = await supabase
      .from('user_habits')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', habitId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async loadTomorrowPlanActions(userId, planDate) {
    const { data, error } = await supabase
      .from('daily_plan_actions')
      .select('id, action_text, completion_measure, minimum_version, stretch_version, is_primary, display_order, is_published')
      .eq('user_id', userId)
      .eq('plan_date', planDate)
      .order('is_primary', { ascending: false })
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async publishTomorrowPlan({ userId, sessionId, planDate, actions }) {
    const { error: deleteError } = await supabase
      .from('daily_plan_actions')
      .delete()
      .eq('user_id', userId)
      .eq('plan_date', planDate);
    if (deleteError) throw deleteError;

    const payload = actions.map((row, index) => ({
      user_id: userId,
      session_id: sessionId,
      plan_date: planDate,
      action_text: row.action_text,
      completion_measure: row.completion_measure || null,
      minimum_version: row.minimum_version || null,
      stretch_version: row.stretch_version || null,
      is_primary: Boolean(row.is_primary),
      display_order: index,
      is_published: true,
    }));

    if (!payload.length) return [];
    const { data, error } = await supabase
      .from('daily_plan_actions')
      .insert(payload)
      .select('id, action_text, completion_measure, minimum_version, stretch_version, is_primary, display_order, is_published')
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },
};
