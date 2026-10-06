import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './supabase/client';
import { getSafeAuthReturn } from './authReturn';

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
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const recoveryPending = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const currentLocation = useRef(location);
  const recoveryReturnTo = useRef('/app');
  currentLocation.current = location;

  const isPasswordRecovery = useCallback(() => recoveryPending.current, []);
  const completePasswordRecovery = useCallback(() => {
    recoveryPending.current = false;
    setPasswordRecovery(false);
  }, []);

  useEffect(() => {
    // FIX: Use onAuthStateChange as the single source of truth.
    // It fires immediately with the current session on mount (INITIAL_SESSION event),
    // so we can rely on it alone and avoid the race condition where getSession()
    // and onAuthStateChange() both resolve and cause double renders/double initSession calls.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Keep this synchronous so callback session checks cannot win the navigation race.
        recoveryPending.current = true;
        recoveryReturnTo.current = getSafeAuthReturn(new URLSearchParams(currentLocation.current.search).get('next'));
        setPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        recoveryPending.current = false;
        setPasswordRecovery(false);
      }
      setUser(session?.user ?? null);
      setLoading(false); // Only set loading false once — after the first auth event
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (passwordRecovery && location.pathname !== '/auth/reset-password') {
      navigate(`/auth/reset-password?next=${encodeURIComponent(recoveryReturnTo.current)}`, { replace: true });
    }
  }, [passwordRecovery, location.pathname, navigate]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
  };

  const value = {
    user,
    loading,
    signOut,
    isPasswordRecovery,
    completePasswordRecovery,
    isLoadingAuth: loading,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}