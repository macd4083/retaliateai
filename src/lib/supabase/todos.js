import { supabase } from './client';

export const todosHelpers = {
  // Get all todos
  async getTodos(userId, completed = null) {
    let query = supabase
      .from('todos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (completed !== null) {
      query = query.eq('completed', completed);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Get single todo
  async getTodo(todoId) {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .eq('id', todoId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create todo
  async createTodo(userId, todoData) {
    const { data, error } = await supabase
      . from('todos')
      .insert({
        user_id: userId,
        ...todoData,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update todo
  async updateTodo(todoId, todoData) {
    const { data, error } = await supabase
      .from('todos')
      .update({
        ...todoData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', todoId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Toggle completed
  async toggleTodo(todoId, completed) {
    const updateData = {
      completed,
      updated_at: new Date().toISOString(),
    };
    
    if (completed) {
      updateData.completed_at = new Date().toISOString();
    } else {
      updateData.completed_at = null;
    }
    
    const { data, error } = await supabase
      .from('todos')
      .update(updateData)
      .eq('id', todoId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete todo
  async deleteTodo(todoId) {
    const { error } = await supabase
      .from('todos')
      .delete()
      .eq('id', todoId);
    
    if (error) throw error;
  },
};