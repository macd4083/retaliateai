import { supabase } from './client';

export const reflectionHelpers = {
  // Get or create today's reflection session
  async getTodaySession(userId) {
    const today = new Date().toISOString().split('T')[0];

    const { data: existing, error: fetchError } = await supabase
      .from('reflection_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (existing) return existing;

    // Create a new session for today
    const { data: created, error: createError } = await supabase
      .from('reflection_sessions')
      .insert({ user_id: userId, date: today })
      .select()
      .single();

    if (createError) throw createError;
    return created;
  },

  // Get yesterday's tomorrow_commitment (the plan they made last night)
  async getYesterdayCommitment(userId) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

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
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

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
    const today = new Date().toISOString().split('T')[0];

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < data.length; i++) {
      const sessionDate = new Date(data[i].date);
      sessionDate.setHours(0, 0, 0, 0);
      const expected = new Date(today);
      expected.setDate(expected.getDate() - i);

      if (sessionDate.getTime() === expected.getTime()) {
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
};
