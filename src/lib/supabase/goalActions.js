import { supabase } from './client';

export const goalActionsHelpers = {
  // Get all actions for a goal
  async getGoalActions(goalId, status = null) {
    let query = supabase
      .from('goal_actions')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Get single action
  async getGoalAction(actionId) {
    const { data, error } = await supabase
      .from('goal_actions')
      .select('*')
      .eq('id', actionId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create action
  async createGoalAction(goalId, actionData) {
    const { data, error } = await supabase
      .from('goal_actions')
      .insert({
        goal_id: goalId,
        ...actionData,
        status: actionData.status || 'active',
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update action
  async updateGoalAction(actionId, actionData) {
    const { data, error } = await supabase
      .from('goal_actions')
      .update(actionData)
      .eq('id', actionId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Mark action as achieved
  async completeGoalAction(actionId) {
    const { data, error } = await supabase
      .from('goal_actions')
      .update({
        status: 'achieved',
        completed_at: new Date().toISOString(),
      })
      .eq('id', actionId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Archive action
  async archiveGoalAction(actionId) {
    const { data, error } = await supabase
      .from('goal_actions')
      .update({ status: 'archived' })
      .eq('id', actionId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete action
  async deleteGoalAction(actionId) {
    const { error } = await supabase
      .from('goal_actions')
      .delete()
      .eq('id', actionId);
    
    if (error) throw error;
  },
};