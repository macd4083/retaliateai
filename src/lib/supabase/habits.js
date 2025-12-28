import { supabase } from './client';

export const habitsHelpers = {
  // Get all habits
  async getHabits(userId, activeOnly = true) {
    let query = supabase
      . from('habits')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (activeOnly) {
      query = query.eq('active', true);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Get single habit
  async getHabit(habitId) {
    const { data, error } = await supabase
      .from('habits')
      .select('*')
      .eq('id', habitId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create habit
  async createHabit(userId, habitData) {
    const { data, error } = await supabase
      .from('habits')
      .insert({
        user_id: userId,
        ...habitData,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update habit
  async updateHabit(habitId, habitData) {
    const { data, error } = await supabase
      .from('habits')
      .update({
        ...habitData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', habitId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete habit
  async deleteHabit(habitId) {
    const { error } = await supabase
      .from('habits')
      .delete()
      .eq('id', habitId);
    
    if (error) throw error;
  },

  // Log habit completion
  async logHabit(userId, habitId, notes = null) {
    const { data, error } = await supabase
      .from('habit_logs')
      .insert({
        user_id: userId,
        habit_id: habitId,
        notes,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Get habit logs
  async getHabitLogs(habitId, startDate = null, endDate = null) {
    let query = supabase
      .from('habit_logs')
      .select('*')
      .eq('habit_id', habitId)
      .order('logged_at', { ascending: false });
    
    if (startDate) {
      query = query. gte('logged_at', startDate);
    }
    if (endDate) {
      query = query.lte('logged_at', endDate);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Get habit completion stats
  async getHabitStats(habitId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate. getDate() - days);
    
    const { data, error } = await supabase
      . from('habit_logs')
      .select('logged_at')
      .eq('habit_id', habitId)
      .gte('logged_at', startDate.toISOString());
    
    if (error) throw error;
    
    return {
      total: data.length,
      days,
      completionRate: (data.length / days) * 100,
    };
  },
};