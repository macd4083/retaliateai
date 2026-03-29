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
        whys: [],
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
      .select('id, title, why_it_matters, whys, category, next_checkin_at, created_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('next_checkin_at', today)
      .not('next_checkin_at', 'is', null);
    if (error) throw error;
    return data || [];
  },

  // Append a new why to a goal's whys array, or replace one at a given index.
  // action: 'add' | 'replace'
  // replaceIndex: 0-based index in current whys array (only used when action='replace')
  async appendGoalWhy(goalId, userId, newWhy, action = 'add', replaceIndex = null) {
    try {
      const { data: goalData } = await supabase
        .from('goals')
        .select('whys, why_it_matters')
        .eq('id', goalId)
        .eq('user_id', userId)
        .single();

      let currentWhys = Array.isArray(goalData?.whys) ? [...goalData.whys] : [];

      // Seed from original why if empty
      if (currentWhys.length === 0 && goalData?.why_it_matters) {
        currentWhys = [{ text: goalData.why_it_matters, added_at: null, source: 'original' }];
      }

      if (action === 'replace' && typeof replaceIndex === 'number' && currentWhys[replaceIndex]) {
        currentWhys[replaceIndex] = newWhy;
      } else {
        currentWhys.push(newWhy);
      }

      const { data, error } = await supabase
        .from('goals')
        .update({ whys: currentWhys })
        .eq('id', goalId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      throw err;
    }
  },
};