import React, { useState } from 'react';
import { supabase } from '../lib/supabase/client';

export default function TrialExpiredModal({ isSecondExpiry = false, onFeedbackExtended }) {
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: 'Bearer '.concat(accessToken) } : {}),
        },
        body: JSON.stringify({ q1, q2 }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Failed to submit feedback');
      }
      setClosed(true);
      onFeedbackExtended?.(payload?.new_trial_ends_at || null);
    } catch (err) {
      setError(err.message || 'Failed to submit feedback');
    } finally {
      setLoading(false);
    }
  };

  if (closed) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950 text-white overflow-y-auto">
      <div className="min-h-full flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl rounded-2xl border border-red-900/50 bg-zinc-900/90 shadow-2xl shadow-red-900/40 p-6 sm:p-8">
          <div className="flex flex-col items-center text-center mb-8">
            <img src="/logo.png" alt="Retaliate AI" className="w-16 h-16 object-contain mb-4" />
            <h1 className="text-3xl font-bold text-white">
              {isSecondExpiry ? 'Your extended trial is up.' : 'Oh! Your free trial ran up.'}
            </h1>
            <p className="text-red-400 mt-3">
              {isSecondExpiry
                ? "You already gave us feedback — thank you. To keep using Retaliate AI, upgrade to a paid plan."
                : 'For another week free — give us your feedback.'}
            </p>
            {!isSecondExpiry && (
              <p className="text-zinc-400 mt-2">Takes 2 minutes. Honest answers only. We actually read these.</p>
            )}
          </div>

          {isSecondExpiry ? (
            <a
              href="/settings"
              className="w-full inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-xl transition-colors"
            >
              Upgrade Now
            </a>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm text-zinc-200 mb-2">
                  What are your favorite and least favorite parts of the app?
                </label>
                <textarea
                  required
                  rows={4}
                  value={q1}
                  onChange={(e) => setQ1(e.target.value)}
                  placeholder="Be honest — what actually worked for you and what didn't?"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-600"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-200 mb-2">
                  What do you think is actually working for you?
                </label>
                <textarea
                  required
                  rows={4}
                  value={q2}
                  onChange={(e) => setQ2(e.target.value)}
                  placeholder="What part of the app, if anything, has made a real difference?"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-600"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors"
              >
                {loading ? 'Submitting...' : 'Submit Feedback & Get Another Week Free'}
              </button>
              <div className="text-center">
                <a href="/settings" className="text-sm text-zinc-300 hover:text-white">
                  Already paying? Upgrade now →
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
