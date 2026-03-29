import { supabase } from './client';

export const goalsHelpers = {
  // Get all goals
  async getGoals(userId, status = null) {
    let query = supabase
      . from('goals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Get single goal
  async getGoal(goalId) {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create goal
  async createGoal(userId, goalData) {
    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id: userId,
        ...goalData,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update goal
  async updateGoal(goalId, goalData) {
    const { data, error } = await supabase
      .from('goals')
      .update({
        ...goalData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', goalId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Mark goal as completed
  async completeGoal(goalId) {
    const { data, error } = await supabase
      .from('goals')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', goalId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete goal
  async deleteGoal(goalId) {
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', goalId);
    
    if (error) throw error;
  },

  // Mark goal as needing a motivation check-in
  async scheduleGoalCheckin(goalId, checkinAfterDate) {
    const { data, error } = await supabase
      .from('goals')
      .update({
        next_checkin_at: checkinAfterDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', goalId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Get goals that are due for a check-in (next_checkin_at <= today and still active)
  async getGoalsDueForCheckin(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('goals')
      .select('id, title, why_it_matters, category, next_checkin_at, created_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('next_checkin_at', today)
      .not('next_checkin_at', 'is', null);
    if (error) throw error;
    return data || [];
  },
};