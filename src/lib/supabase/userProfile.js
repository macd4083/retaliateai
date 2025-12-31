import { supabase } from './client';

export const userProfileHelpers = {
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId) // Changed from 'user_id' to 'id'
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  },

  async updateProfile(userId, profileData) {
    // Check if profile exists
    const existingProfile = await this.getProfile(userId);

    if (existingProfile) {
      // Update existing profile with structured data
      const { data, error } = await supabase
        .from('user_profiles')
        .update({
          summary_text: JSON.stringify(profileData),
          short_term_state: profileData.short_term_state,
          long_term_patterns:  profileData.long_term_patterns,
          growth_areas: profileData.growth_areas,
          strengths: profileData.strengths,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId) // Changed from 'user_id' to 'id'
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      // Create new profile
      const { data, error } = await supabase
        . from('user_profiles')
        .insert({
          id: userId, // Changed from 'user_id' to 'id'
          summary_text: JSON.stringify(profileData),
          short_term_state: profileData.short_term_state,
          long_term_patterns: profileData.long_term_patterns,
          growth_areas: profileData.growth_areas,
          strengths: profileData.strengths,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  },

  async updateSummary(userId, summaryText) {
    // Backwards compatibility - if just text is passed
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        summary_text: summaryText,
        summary_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId) // Changed from 'user_id' to 'id'
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getProfileHistory(userId, limit = 10) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId) // Changed from 'user_id' to 'id'
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  },
};