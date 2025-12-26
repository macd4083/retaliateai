import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import TermsAgreement from './TermsAgreement';

export default function AuthGuard({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [needsTerms, setNeedsTerms] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const isAuth = await base44.auth.isAuthenticated();
      if (!isAuth) {
        base44.auth.redirectToLogin(window.location.pathname);
        return;
      }

      const currentUser = await base44.auth.me();
      setUser(currentUser);

      if (!currentUser.agreed_to_terms) {
        setNeedsTerms(true);
      }
      
      setLoading(false);
    } catch (error) {
      base44.auth.redirectToLogin(window.location.pathname);
    }
  };

  const handleAcceptTerms = async (data) => {
    try {
      await base44.auth.updateMe(data);
      setNeedsTerms(false);
      setUser({ ...user, ...data });
    } catch (error) {
      console.error('Failed to update terms:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (needsTerms) {
    return <TermsAgreement onAccept={handleAcceptTerms} />;
  }

  return children;
}
