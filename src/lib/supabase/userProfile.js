import { supabase } from './client';

export const userProfileHelpers = {
  // Get user profile
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create or update profile
  async upsertProfile(userId, profileData) {
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({
        id: userId,
        ...profileData,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update summary (for AI context)
  async updateSummary(userId, summaryText, summaryFields = {}) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        summary_text: summaryText,
        summary_updated_at: new Date().toISOString(),
        ...summaryFields,
      })
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
};