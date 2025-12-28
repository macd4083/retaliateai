import { supabase } from './client';

export const authHelpers = {
  // Get current user
  async getCurrentUser() {
    const { data:  { user }, error } = await supabase. auth.getUser();
    if (error) throw error;
    return user;
  },

  // Sign up
  async signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    return data;
  },

  // Sign in
  async signIn(email, password) {
    const { data, error } = await supabase. auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  },

  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  // Listen to auth changes
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },
};