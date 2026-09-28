import { supabase } from '../../lib/supabase/client';
import { localDateStr } from '../../lib/dateUtils';

export const WEEKDAY_LABELS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];

export function weekdayIndexToday() {
  return new Date().getDay();
}

export async function seedDefaultHabits(userId) {
  const { error } = await supabase.rpc('seed_default_habits_for_user', { p_user_id: userId });
  return { error: error || null };
}

async function ensureTodayReview(userId, reviewDate) {
  const { data: existing, error } = await supabase
    .from('v2_daily_reviews')
    .select('id, review_date, desired_direction')
    .eq('user_id', userId)
    .eq('review_date', reviewDate)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('v2_daily_reviews')
    .insert({ user_id: userId, review_date: reviewDate })
    .select('id, review_date, desired_direction')
    .single();

  if (createError) throw createError;
  return created;
}

export async function loadTodayReviewState(userId) {
  const today = localDateStr(0);
  const yesterday = localDateStr(-1);

  const [review, plannedRes, todayPlannedRes, followRes, habitsRes, habitLogsRes] = await Promise.all([
    ensureTodayReview(userId, today),
    supabase
      .from('v2_planned_actions')
      .select('id, action_text, action_order')
      .eq('user_id', userId)
      .eq('review_date', yesterday)
      .order('action_order', { ascending: true }),
    supabase
      .from('v2_planned_actions')
      .select('id, action_text, action_order')
      .eq('user_id', userId)
      .eq('review_date', today)
      .order('action_order', { ascending: true }),
    supabase
      .from('v2_follow_through_items')
      .select('id, action_text, action_order, completed, source_action_id')
      .eq('user_id', userId)
      .eq('review_date', today)
      .order('action_order', { ascending: true }),
    supabase
      .from('v2_habit_definitions')
      .select('id, name, habit_type, unit, weekdays, is_archived')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: true }),
    supabase
      .from('v2_habit_logs')
      .select('habit_id, boolean_value, number_value')
      .eq('user_id', userId)
      .eq('log_date', today),
  ]);

  if (plannedRes.error) throw plannedRes.error;
  if (todayPlannedRes.error) throw todayPlannedRes.error;
  if (followRes.error) throw followRes.error;
  if (habitsRes.error) throw habitsRes.error;
  if (habitLogsRes.error) throw habitLogsRes.error;

  let followThroughItems = followRes.data || [];
  const yesterdayActions = plannedRes.data || [];

  if (followThroughItems.length === 0 && yesterdayActions.length > 0) {
    const insertPayload = yesterdayActions.map((a, index) => ({
      user_id: userId,
      review_date: today,
      source_action_id: a.id,
      action_text: a.action_text,
      action_order: index,
      completed: false,
    }));

    const { error: seedFollowError } = await supabase
      .from('v2_follow_through_items')
      .upsert(insertPayload, { onConflict: 'user_id,review_date,action_text,action_order' });

    if (seedFollowError) throw seedFollowError;

    const { data: refreshed, error: refreshError } = await supabase
      .from('v2_follow_through_items')
      .select('id, action_text, action_order, completed, source_action_id')
      .eq('user_id', userId)
      .eq('review_date', today)
      .order('action_order', { ascending: true });

    if (refreshError) throw refreshError;
    followThroughItems = refreshed || [];
  }

  return {
    today,
    yesterday,
    review,
    yesterdayActions,
    todayPlannedActions: todayPlannedRes.data || [],
    followThroughItems,
    habits: habitsRes.data || [],
    habitLogs: habitLogsRes.data || [],
  };
}

export async function setFollowThroughCompletion(itemId, completed) {
  const { error } = await supabase
    .from('v2_follow_through_items')
    .update({ completed })
    .eq('id', itemId);

  if (error) throw error;
}

export async function addManualFollowThroughItem(userId, reviewDate, actionText, actionOrder) {
  const { data, error } = await supabase
    .from('v2_follow_through_items')
    .insert({
      user_id: userId,
      review_date: reviewDate,
      action_text: actionText,
      action_order: actionOrder,
      completed: false,
    })
    .select('id, action_text, action_order, completed, source_action_id')
    .single();

  if (error) throw error;
  return data;
}

export async function upsertHabitDefinition(userId, habit) {
  const payload = {
    user_id: userId,
    name: habit.name,
    habit_type: habit.habit_type,
    unit: habit.unit || null,
    weekdays: habit.weekdays,
    is_archived: false,
  };

  if (habit.id) {
    const { error } = await supabase.from('v2_habit_definitions').update(payload).eq('id', habit.id);
    if (error) throw error;
    return habit.id;
  }

  const { data, error } = await supabase.from('v2_habit_definitions').insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function archiveHabit(habitId) {
  const { error } = await supabase
    .from('v2_habit_definitions')
    .update({ is_archived: true })
    .eq('id', habitId);

  if (error) throw error;
}

export async function upsertHabitLog(userId, logDate, habitId, habitType, value) {
  const payload = {
    user_id: userId,
    habit_id: habitId,
    log_date: logDate,
    boolean_value: habitType === 'boolean' ? Boolean(value) : null,
    number_value: habitType === 'number' ? Number.isFinite(value) ? value : null : null,
  };

  const { error } = await supabase
    .from('v2_habit_logs')
    .upsert(payload, { onConflict: 'user_id,habit_id,log_date' });

  if (error) throw error;
}

export async function updateDesiredDirection(reviewId, desiredDirection) {
  const { error } = await supabase
    .from('v2_daily_reviews')
    .update({ desired_direction: desiredDirection })
    .eq('id', reviewId);

  if (error) throw error;
}

export async function replaceTomorrowActions(userId, reviewDate, actionTexts) {
  const { error: deleteError } = await supabase
    .from('v2_planned_actions')
    .delete()
    .eq('user_id', userId)
    .eq('review_date', reviewDate);

  if (deleteError) throw deleteError;
  if (actionTexts.length === 0) return;

  const payload = actionTexts.map((actionText, index) => ({
    user_id: userId,
    review_date: reviewDate,
    action_text: actionText,
    action_order: index,
  }));

  const { error: insertError } = await supabase.from('v2_planned_actions').insert(payload);
  if (insertError) throw insertError;
}
