import { supabase } from './client';

export const journalHelpers = {
  // Get all journal entries for user
  async getEntries(userId, { limit = 50, offset = 0, orderBy = 'created_at', ascending = false } = {}) {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', userId)
      .order(orderBy, { ascending })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    return data;
  },

  // Get single entry
  async getEntry(entryId) {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('id', entryId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create entry
  async createEntry(userId, entryData) {
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({
        user_id: userId,
        title: entryData.title || null,
        content: entryData.content,
        // Removed:  mood_rating, tags, word_count
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update entry
  async updateEntry(entryId, entryData) {
    const { data, error } = await supabase
      .from('journal_entries')
      .update({
        ... entryData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete entry
  async deleteEntry(entryId) {
    const { error } = await supabase
      .from('journal_entries')
      .delete()
      .eq('id', entryId);
    
    if (error) throw error;
  },

  // Search entries by text
  async searchEntries(userId, searchQuery) {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', userId)
      .textSearch('search_vector', searchQuery)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  // Get entries by date range
  async getEntriesByDateRange(userId, startDate, endDate) {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  // Update embedding (for AI semantic search)
  async updateEmbedding(entryId, embedding) {
    const { data, error } = await supabase
      .from('journal_entries')
      .update({ embedding })
      .eq('id', entryId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Semantic search (vector similarity)
  async semanticSearch(userId, queryEmbedding, limit = 10) {
    // This uses pgvector's <=> operator for cosine similarity
    const { data, error } = await supabase. rpc('match_journal_entries', {
      query_embedding:  queryEmbedding,
      match_user_id: userId,
      match_count: limit,
    });
    
    if (error) throw error;
    return data;
  },
};