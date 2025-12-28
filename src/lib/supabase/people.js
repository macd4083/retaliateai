import { supabase } from './client';

export const peopleHelpers = {
  // Get all people
  async getPeople(userId) {
    const { data, error } = await supabase
      .from('people')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  // Get single person
  async getPerson(personId) {
    const { data, error } = await supabase
      .from('people')
      .select('*')
      .eq('id', personId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create person
  async createPerson(userId, personData) {
    const { data, error } = await supabase
      .from('people')
      .insert({
        user_id: userId,
        ...personData,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update person
  async updatePerson(personId, personData) {
    const { data, error } = await supabase
      .from('people')
      .update({
        ... personData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', personId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete person
  async deletePerson(personId) {
    const { error } = await supabase
      .from('people')
      .delete()
      .eq('id', personId);
    
    if (error) throw error;
  },

  // Update last interaction date
  async logInteraction(personId, date = new Date()) {
    const { data, error } = await supabase
      .from('people')
      .update({
        last_interaction_date: date.toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      })
      .eq('id', personId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
};