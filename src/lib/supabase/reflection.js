import { supabase } from './client';
import { localDateStr } from '../dateUtils';

export const reflectionHelpers = {
  // Get or create today's reflection session
  async getTodaySession(userId) {
    const today = localDateStr();

    // Upsert: insert if not exists, return existing if already there
    const { data, error } = await supabase
      .from('reflection_sessions')
      .upsert(
        { user_id: userId, date: today },
        { onConflict: 'user_id,date', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get yesterday's tomorrow_commitment (the plan they made last night)
  async getYesterdayCommitment(userId) {
    const yesterdayStr = localDateStr(-1);

    const { data, error } = await supabase
      .from('reflection_sessions')
      .select('tomorrow_commitment')
      .eq('user_id', userId)
      .eq('date', yesterdayStr)
      .maybeSingle();

    if (error) throw error;
    return data?.tomorrow_commitment || null;
  },

  // Save a message to reflection_messages
  async saveMessage(sessionId, userId, messageData) {
    const { data, error } = await supabase
      .from('reflection_messages')
      .insert({
        session_id: sessionId,
        user_id: userId,
        role: messageData.role,
        content: messageData.content,
        stage: messageData.stage || null,
        message_type: messageData.message_type || null,
        chips: messageData.chips || null,
        chip_selected: messageData.chip_selected || null,
        extracted_data: messageData.extracted_data || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Update a reflection session
  async updateSession(sessionId, updates) {
    const { data, error } = await supabase
      .from('reflection_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get recent patterns for a user
  async getRecentPatterns(userId, days = 14) {
    const sinceStr = localDateStr(-days);

    const { data, error } = await supabase
      .from('reflection_patterns')
      .select('*')
      .eq('user_id', userId)
      .gte('last_seen_date', sinceStr)
      .order('last_seen_date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  // Upsert a pattern (insert or increment occurrence_count)
  async upsertPattern(userId, patternData) {
    const today = localDateStr();

    // Check if a pattern with same type+label already exists
    const { data: existing, error: fetchError } = await supabase
      .from('reflection_patterns')
      .select('*')
      .eq('user_id', userId)
      .eq('pattern_type', patternData.pattern_type)
      .eq('label', patternData.label)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existing) {
      const { data, error } = await supabase
        .from('reflection_patterns')
        .update({
          occurrence_count: existing.occurrence_count + 1,
          last_seen_date: today,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('reflection_patterns')
      .insert({
        user_id: userId,
        pattern_type: patternData.pattern_type,
        label: patternData.label,
        description: patternData.description || null,
        occurrence_count: 1,
        last_seen_date: today,
        first_seen_date: today,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Count consecutive days with is_complete = true (the streak)
  async getReflectionStreak(userId) {
    const { data, error } = await supabase
      .from('reflection_sessions')
      .select('date, is_complete')
      .eq('user_id', userId)
      .eq('is_complete', true)
      .order('date', { ascending: false })
      .limit(60);

    if (error) throw error;
    if (!data || data.length === 0) return 0;

    let streak = 0;
    const todayTime = new Date();
    todayTime.setHours(0, 0, 0, 0);
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (let i = 0; i < data.length; i++) {
      // Parse as local midnight to avoid UTC offset shifting the date by one day
      const [y, m, d] = data[i].date.split('-').map(Number);
      const sessionDate = new Date(y, m - 1, d);
      sessionDate.setHours(0, 0, 0, 0);
      const expectedTime = todayTime.getTime() - i * oneDayMs;

      if (sessionDate.getTime() === expectedTime) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  },

  // Get all messages for a session ordered by created_at
  async getSessionMessages(sessionId) {
    const { data, error } = await supabase
      .from('reflection_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  // ── Intelligent coaching helpers ──────────────────────────────────────────

  /**
   * Get due follow-ups: items where check_back_after <= today OR
   * trigger_condition matches any of the provided currentSignals.
   * Only returns non-triggered items.
   */
  async getFollowUpQueue(userId, currentSignals = []) {
    const today = localDateStr();
    const { data, error } = await supabase
      .from('follow_up_queue')
      .select('*')
      .eq('user_id', userId)
      .eq('triggered', false)
      .is('resolved_at', null);

    if (error) throw error;
    if (!data) return [];

    return data.filter((item) => {
      if (item.check_back_after <= today) return true;
      if (item.trigger_condition && currentSignals.includes(item.trigger_condition)) return true;
      return false;
    });
  },

  /** Mark a follow-up item as triggered (surfaced to the user). */
  async markFollowUpTriggered(followUpId) {
    const { data, error } = await supabase
      .from('follow_up_queue')
      .update({ triggered: true })
      .eq('id', followUpId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /** Insert a new follow-up into the queue. */
  async queueFollowUp(userId, sessionId, { context, question, check_back_after, trigger_condition }) {
    const fallbackDate = localDateStr(3);

    const { data, error } = await supabase
      .from('follow_up_queue')
      .insert({
        user_id: userId,
        session_id: sessionId || null,
        context,
        question,
        check_back_after: check_back_after || fallbackDate,
        trigger_condition: trigger_condition || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get or upsert a growth marker for a theme.
   * If the theme exists: increment occurrence_count and add the exercise.
   * If occurrence_count >= 3 and check_in_after is null: schedule check-in 14 days out.
   */
  async upsertGrowthMarker(userId, theme, { exercise_run, check_in_message } = {}) {
    const { data: existing, error: fetchError } = await supabase
      .from('growth_markers')
      .select('*')
      .eq('user_id', userId)
      .eq('theme', theme)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existing) {
      const exercises = Array.isArray(existing.exercises_run) ? existing.exercises_run : [];
      if (exercise_run && !exercises.includes(exercise_run)) exercises.push(exercise_run);
      const newCount = (existing.occurrence_count || 1) + 1;

      const shouldScheduleCheckIn = newCount >= 3 && !existing.check_in_after;

      const { data, error } = await supabase
        .from('growth_markers')
        .update({
          occurrence_count: newCount,
          exercises_run: exercises,
          check_in_after: shouldScheduleCheckIn ? localDateStr(14) : existing.check_in_after,
          check_in_message: check_in_message || existing.check_in_message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    // New marker
    const { data, error } = await supabase
      .from('growth_markers')
      .insert({
        user_id: userId,
        theme,
        exercises_run: exercise_run ? [exercise_run] : [],
        occurrence_count: 1,
        check_in_message: check_in_message || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /** Get growth markers whose check-in is due (checked_in=false AND check_in_after <= today). */
  async getDueGrowthMarkers(userId) {
    const today = localDateStr();
    const { data, error } = await supabase
      .from('growth_markers')
      .select('*')
      .eq('user_id', userId)
      .eq('checked_in', false)
      .lte('check_in_after', today)
      .not('check_in_after', 'is', null);

    if (error) throw error;
    return data || [];
  },

  /**
   * Merge checklistUpdates into the existing checklist JSONB on a session.
   * Only sets keys to true — never downgrades a true to false.
   */
  async updateSessionChecklist(sessionId, checklistUpdates) {
    const { data: current, error: fetchError } = await supabase
      .from('reflection_sessions')
      .select('checklist')
      .eq('id', sessionId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const base = current?.checklist || { wins: false, honest: false, plan: false, identity: false };
    const merged = { ...base };
    Object.keys(checklistUpdates).forEach((key) => {
      if (checklistUpdates[key]) merged[key] = true;
    });

    const { data, error } = await supabase
      .from('reflection_sessions')
      .update({ checklist: merged, updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get a lightweight summary of the last N sessions (no full messages).
   * Returns: date, wins[], misses[], tomorrow_commitment, current_stage, checklist, mood_end_of_day
   */
  async getRecentSessionsSummary(userId, n = 7) {
    const { data, error } = await supabase
      .from('reflection_sessions')
      .select('date, wins, misses, tomorrow_commitment, current_stage, checklist, mood_end_of_day')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(n);

    if (error) throw error;
    return data || [];
  },
};
