import { supabase } from './client';

export const insightsHelpers = {
  // Get all insights
  async getInsights(userId, dismissed = false) {
    const { data, error } = await supabase
      .from('ai_insights')
      .select('*')
      .eq('user_id', userId)
      .eq('dismissed', dismissed)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  // Get single insight
  async getInsight(insightId) {
    const { data, error } = await supabase
      .from('ai_insights')
      .select('*')
      .eq('id', insightId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create insight
  async createInsight(userId, insightData) {
    const { data, error } = await supabase
      .from('ai_insights')
      .insert({
        user_id: userId,
        ...insightData,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Dismiss insight
  async dismissInsight(insightId) {
    const { data, error } = await supabase
      .from('ai_insights')
      .update({ dismissed: true })
      .eq('id', insightId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete insight
  async deleteInsight(insightId) {
    const { error } = await supabase
      .from('ai_insights')
      .delete()
      .eq('id', insightId);
    
    if (error) throw error;
  },
};