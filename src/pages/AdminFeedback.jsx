import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import AppShellV2 from '../components/v2/AppShellV2';

export default function AdminFeedback() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(null); // null = loading
  const [feedback, setFeedback] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState({});

  // ── Admin check ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.role === 'admin') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate('/reflection', { replace: true });
        }
      })
      .catch(() => {
        setIsAdmin(false);
        navigate('/reflection', { replace: true });
      });
  }, [user?.id]);

  // ── Load feedback ─────────────────────────────────────────────────────────

  const loadFeedback = async () => {
    setFeedbackLoading(true);
    const { data } = await supabase
      .from('user_feedback')
      .select('*')
      .order('submitted_at', { ascending: false });
    setFeedback(data || []);
    setFeedbackLoading(false);
  };

  useEffect(() => {
    if (isAdmin) loadFeedback();
  }, [isAdmin]);

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (entry) => {
    if (!confirm('Delete this feedback?')) return;
    const { error } = await supabase
      .from('user_feedback')
      .delete()
      .eq('id', entry.id);
    if (error) {
      setDeleteErrors((prev) => ({ ...prev, [entry.id]: 'Delete failed. Try again.' }));
    } else {
      setFeedback((prev) => prev.filter((f) => f.id !== entry.id));
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    }
  };

  // ── Loading / not admin ───────────────────────────────────────────────────

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShellV2 title="User Feedback">
      <div className="h-full overflow-y-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-red-500" />
          <h2 className="text-white font-semibold text-lg">User Feedback</h2>
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-900/40 border border-red-800 text-red-400">DEV</span>
          <button
            onClick={loadFeedback}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* Count */}
        <p className="text-zinc-400 text-sm">{feedback.length} submission{feedback.length !== 1 ? 's' : ''}</p>

        {/* Loading */}
        {feedbackLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!feedbackLoading && feedback.length === 0 && (
          <p className="text-zinc-500 text-sm">No feedback submitted yet.</p>
        )}

        {/* Feedback cards */}
        {!feedbackLoading && feedback.map((entry) => (
          <div
            key={entry.id}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 space-y-3"
          >
            {/* Meta row */}
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-zinc-400 text-xs">
                  {entry.submitted_at
                    ? new Date(entry.submitted_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
                <p className="text-zinc-500 text-xs">
                  User: {entry.user_id?.slice(0, 8)}…
                  {entry.trial_extended && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-900/40 border border-emerald-800 text-emerald-400">
                      trial_extended
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => handleDelete(entry)}
                className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors flex-shrink-0"
                aria-label="Delete feedback"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Q1 */}
            <div className="space-y-1">
              <p className="text-zinc-400 text-xs font-medium">Q1: What are your favorite and least favorite parts?</p>
              <p className="text-white text-sm whitespace-pre-wrap">{entry.q1_favorite_least_favorite || <span className="text-zinc-600 italic">No answer</span>}</p>
            </div>

            {/* Q2 */}
            <div className="space-y-1">
              <p className="text-zinc-400 text-xs font-medium">Q2: What do you think is actually working for you?</p>
              <p className="text-white text-sm whitespace-pre-wrap">{entry.q2_whats_working || <span className="text-zinc-600 italic">No answer</span>}</p>
            </div>

            {/* Inline delete error */}
            {deleteErrors[entry.id] && (
              <p className="text-red-400 text-xs">{deleteErrors[entry.id]}</p>
            )}
          </div>
        ))}

      </div>
    </AppShellV2>
  );
}
