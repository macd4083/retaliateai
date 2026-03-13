import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase/client';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // FIX: Use onAuthStateChange as the single source of truth.
    // It fires immediately with the current session on mount (INITIAL_SESSION event),
    // so we can rely on it alone and avoid the race condition where getSession()
    // and onAuthStateChange() both resolve and cause double renders/double initSession calls.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false); // Only set loading false once — after the first auth event
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const value = {
    user,
    loading,
    signOut,
    isLoadingAuth: loading,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}