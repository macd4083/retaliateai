import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, BarChart2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { isAnonymousGuestUser } from '../lib/guestSession';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';
import TrendChart from '../v2/components/TrendChart';
import { TREND_RANGES, buildCommitmentTrend } from '../v2/today/trends';
import { getTodayV2DateContext } from '../v2/today/model';
import { loadCommitmentHistory } from '../v2/services/commitmentHistory';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InsightsV2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [allCommitments, setAllCommitments]       = useState([]);
  const [trendRange, setTrendRange]               = useState('7D');
  const [commitmentHistory, setCommitmentHistory] = useState({ fragments: [], legacySessions: [] });
  const [trendError, setTrendError]               = useState(false);
  const trendRequest = useRef(0);
  const [streak, setStreak]                       = useState(0);
  const [loading, setLoading]                     = useState(true);
  const [activeGoals, setActiveGoals]             = useState([]);
  const [showAddGoal, setShowAddGoal]             = useState(false);
  const [newGoalTitle, setNewGoalTitle]           = useState('');
  const [newGoalBaseline, setNewGoalBaseline]     = useState('');
  const [savingGoal, setSavingGoal]               = useState(false);
  const [fragmentHistory, setFragmentHistory]     = useState([]);
  const [archivedGoals, setArchivedGoals]         = useState([]);
  const [showArchived, setShowArchived]           = useState(false);
  const [openGoalMenu, setOpenGoalMenu]           = useState(null); // goalId | null
  const [goalActionLoading, setGoalActionLoading] = useState(null); // goalId | null

  useEffect(() => {
    if (!user?.id) return;
    loadData();
    return () => { trendRequest.current += 1; };
  }, [user?.id]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && user?.id) {
        loadData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id]);

  useEffect(() => {
    const handleClickOutsideGoalMenu = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-goal-menu-root="true"]')) {
        setOpenGoalMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutsideGoalMenu);
    return () => document.removeEventListener('mousedown', handleClickOutsideGoalMenu);
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([
        loadSessions(),
        loadStreak(),
        loadCommitmentStats(),
        loadActiveGoals(),
        loadArchivedGoals(),
        loadFragmentHistory(),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadActiveGoals() {
    const { data } = await supabase
      .from('goals')
      .select('id, title, whys, status, created_at, last_mentioned_at, last_motivation_signal, baseline_snapshot, baseline_date')
      .eq('user_id', user.id)
      .or('status.eq.active,status.is.null')
      .order('created_at', { ascending: true })
      .limit(10);
    setActiveGoals(data || []);
  }

  async function loadArchivedGoals() {
    const { data } = await supabase
      .from('goals')
      .select('id, title, whys, status, created_at, last_mentioned_at, last_motivation_signal, baseline_snapshot, baseline_date')
      .eq('user_id', user.id)
      .in('status', ['archived', 'paused', 'achieved'])
      .order('created_at', { ascending: false })
      .limit(20);
    setArchivedGoals(data || []);
  }

  async function handleSaveGoal() {
    if (!newGoalTitle.trim()) return;
    setSavingGoal(true);
    try {
      const { error } = await supabase.from('goals').insert({
        user_id: user.id,
        title: newGoalTitle.trim(),
        status: 'active',
        whys: [],
        ...(newGoalBaseline.trim() && {
          baseline_snapshot: newGoalBaseline.trim(),
          baseline_date: new Date().toISOString().split('T')[0],
        }),
      });
      if (error) {
        console.error('Failed to save goal:', error.message);
        return;
      }
      setNewGoalTitle('');
      setNewGoalBaseline('');
      setShowAddGoal(false);
      await loadActiveGoals();
    } finally {
      setSavingGoal(false);
    }
  }

  async function handleArchiveGoal(goalId) {
    setGoalActionLoading(goalId);
    try {
      await supabase.from('goals').update({ status: 'archived' }).eq('id', goalId).eq('user_id', user.id);
      await Promise.all([loadActiveGoals(), loadArchivedGoals()]);
    } finally {
      setGoalActionLoading(null);
    }
  }

  async function handleDeleteGoal(goalId) {
    setGoalActionLoading(goalId);
    try {
      await supabase.from('goals').delete().eq('id', goalId).eq('user_id', user.id);
      await Promise.all([loadActiveGoals(), loadArchivedGoals()]);
    } finally {
      setGoalActionLoading(null);
    }
  }

  async function handleReactivateGoal(goalId) {
    setGoalActionLoading(goalId);
    try {
      await supabase.from('goals').update({ status: 'active' }).eq('id', goalId).eq('user_id', user.id);
      await Promise.all([loadActiveGoals(), loadArchivedGoals()]);
    } finally {
      setGoalActionLoading(null);
    }
  }

  async function loadFragmentHistory() {
    const { data: sessions } = await supabase
      .from('reflection_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_complete', true)
      .order('date', { ascending: false })
      .limit(3);

    if (!sessions || sessions.length === 0) {
      setFragmentHistory([]);
      return;
    }

    const sessionIds = sessions.map((s) => s.id);

    const { data: fragments } = await supabase
      .from('goal_commitment_log')
      .select('id, commitment_text, kept, goal_id, session_id, date')
      .in('session_id', sessionIds);

    if (!fragments || fragments.length === 0) {
      setFragmentHistory([]);
      return;
    }

    const goalIds = [...new Set(fragments.filter((f) => f.goal_id).map((f) => f.goal_id))];
    let goalsMap = {};
    if (goalIds.length > 0) {
      const { data: goals } = await supabase
        .from('goals')
        .select('id, title, whys')
        .in('id', goalIds);
      for (const g of goals || []) {
        goalsMap[g.id] = g;
      }
    }

    const enriched = fragments.map((f) => {
      const goal = f.goal_id ? goalsMap[f.goal_id] : null;
      const whys = Array.isArray(goal?.whys) ? goal.whys : [];
      const lastWhy = whys.length > 0 ? whys[whys.length - 1] : null;
      return {
        ...f,
        goal_title: goal?.title ?? null,
        goal_why: lastWhy?.text ?? null,
      };
    });

    setFragmentHistory(enriched);
  }

  // Intentionally does not select reflection_streak — live streak is computed in loadStreak() via reflectionHelpers.getReflectionStreak()
  async function loadSessions() {
    const today = localDateStr(0);

    // Fetch sessions with either a commitment or a commitment score (desc, up to 100)
    const { data: allWithCommitment } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, commitment_minimum, commitment_stretch, commitment_score, is_complete')
      .eq('user_id', user.id)
      .or('tomorrow_commitment.not.is.null,commitment_score.not.is.null')
      .order('date', { ascending: false })
      .limit(100);

    // Include if it has a score, or if complete, or if date is before today
    const eligibleCommitments = (allWithCommitment || []).filter(
      (s) => s.commitment_score !== null || s.is_complete || s.date < today
    );

    if (eligibleCommitments.length > 0) {
      const newestDate = eligibleCommitments[0].date;
      const oldestDate = eligibleCommitments[eligibleCommitments.length - 1].date;

      // Fetch sessions in range +1 day buffer for next-day lookups (Sunday edge case)
      const { data: lookupSessions } = await supabase
        .from('reflection_sessions')
        .select('date, is_complete')
        .eq('user_id', user.id)
        .gte('date', oldestDate)
        .lte('date', addDays(newestDate, 1))
        .order('date', { ascending: true });

      const sessionsByDate = {};
      for (const s of lookupSessions || []) {
        sessionsByDate[s.date] = s;
      }

      const computed = eligibleCommitments.map((s, idx) => {
        const hasCommitmentText = s.tomorrow_commitment !== null;
        const nextDay = addDays(s.date, 1);
        const isNewest = idx === 0;
        const status = !hasCommitmentText
          ? 'pending'
          : isNewest
            ? (sessionsByDate[nextDay]?.is_complete ? 'kept' : 'pending')
            : (sessionsByDate[nextDay]?.is_complete ? 'kept' : 'missed');
        return {
          date: s.date,
          commitment: s.tomorrow_commitment ?? null,
          minimum: s.commitment_minimum || null,
          stretch: s.commitment_stretch || null,
          score: s.commitment_score ?? null,
          status,
        };
      });

      setAllCommitments(computed);
    } else {
      setAllCommitments([]);
    }
  }

  async function loadStreak() {
    const s = await reflectionHelpers.getReflectionStreak(user.id);
    setStreak(s);
  }

  async function loadCommitmentStats() {
    const request = ++trendRequest.current;
    setTrendError(false);
    setCommitmentHistory({ fragments: [], legacySessions: [] });
    try {
      const history = await loadCommitmentHistory(user.id, getTodayV2DateContext().todayLocalDate);
      if (request === trendRequest.current) setCommitmentHistory(history);
    } catch (_e) {
      if (request === trendRequest.current) setTrendError(true);
    }
  }

  if (isAnonymousGuestUser(user)) {
    return (
      <AppShellV2 title="Progress">
        <div className="h-full overflow-y-auto flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
            <BarChart2 className="w-8 h-8 text-zinc-500" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-lg mb-2">Save Your Progress</h2>
            <p className="text-zinc-400 text-sm max-w-xs leading-relaxed">
              Sign up or log in to track your streaks, commitments, and personal growth over time.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => navigate('/login?signup=true')}
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-full transition-colors"
            >
              Sign Up
            </button>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 text-red-400 hover:text-red-300 font-medium transition-colors"
            >
              Log In
            </button>
          </div>
        </div>
      </AppShellV2>
    );
  }

  if (loading) {
    return (
      <AppShellV2 title="Progress">
        <div className="h-full overflow-y-auto flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
        </div>
      </AppShellV2>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const yesterday = addDays(localDateStr(0), -1);
  const yesterdayCommitment = allCommitments.find((c) => c.date === yesterday && c.commitment !== null) || null;

  const keptFragments   = fragmentHistory.filter((f) => f.kept === true);
  const missedFragments = fragmentHistory.filter((f) => f.kept === false);

  return (
    <AppShellV2 title="Progress">
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">

          {/* ── ZONE 1: Momentum ──────────────────────────────────────────── */}

          {/* Section 1: Consistency Tracker */}
          {trendError ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="text-sm font-medium text-zinc-300">Commitments kept</h2>
              <p role="alert" className="mt-3 text-sm text-zinc-400">Could not load commitment history.</p>
              <button type="button" onClick={loadCommitmentStats} className="mt-3 rounded-lg border border-zinc-700 px-3 py-2 text-xs">Try again</button>
            </section>
          ) : <TrendChart
            title="Commitments kept"
            description="Daily kept rate · unanswered commitments are excluded. Earlier history uses recorded commitment scores."
            points={buildCommitmentTrend(commitmentHistory.fragments, commitmentHistory.legacySessions, getTodayV2DateContext().todayLocalDate, trendRange)}
            controls={<div role="group" aria-label="Commitment chart time range" className="flex gap-1 rounded-full border border-zinc-800 p-1">
              {TREND_RANGES.map((range) => <button key={range.value} type="button" aria-label={range.label} aria-pressed={trendRange === range.value}
                onClick={() => setTrendRange(range.value)} className={`min-h-8 rounded-full px-3 text-xs transition-colors ${trendRange === range.value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>{range.value === 'ALL' ? 'All' : range.value}</button>)}
            </div>}
          />}

          {/* Section 2: Streak */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-white font-semibold text-lg">{streak} night streak</p>
              <p className="text-zinc-500 text-sm">Keep showing up.</p>
            </div>
          </div>

          {/* Section 3: Commitments (yesterday only) */}
          {yesterdayCommitment && (
            <div>
              <h2 className="text-white font-semibold text-base mb-3">Commitments</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="flex-shrink-0 mt-0.5">
                    {yesterdayCommitment.status === 'kept'   ? '✅' :
                     yesterdayCommitment.status === 'missed' ? '❌' : '⏳'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-200 text-sm leading-snug">{yesterdayCommitment.commitment}</p>
                    {yesterdayCommitment.minimum && (
                      <p className="text-zinc-600 text-xs mt-0.5">
                        <span className="text-zinc-500">Minimum:</span> {yesterdayCommitment.minimum}
                      </p>
                    )}
                    {yesterdayCommitment.stretch && (
                      <p className="text-zinc-600 text-xs mt-0.5">
                        <span className="text-zinc-500">Stretch:</span> {yesterdayCommitment.stretch}
                      </p>
                    )}
                    <p className="text-zinc-500 text-xs mt-0.5">
                      {formatDate(yesterdayCommitment.date)} ·{' '}
                      {yesterdayCommitment.status === 'kept'   ? 'Kept' :
                       yesterdayCommitment.status === 'missed' ? 'Missed' :
                       'Pending — check back tomorrow'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section: Kept */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Kept</h2>
            {keptFragments.length > 0 ? (
              <div className="space-y-2">
                {keptFragments.map((f) => (
                  <div key={f.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                    <p className="text-zinc-200 text-sm leading-relaxed">
                      {f.commitment_text}
                      {f.goal_title && (
                        <span className="text-zinc-500">
                          {' '}— related to your {f.goal_title} goal
                          {f.goal_why && `, it was important because ${f.goal_why}`}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                No kept commitments in your last 3 sessions yet.
              </p>
            )}
          </section>

          {/* Section: Missed */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Missed</h2>
            {missedFragments.length > 0 ? (
              <div className="space-y-2">
                {missedFragments.map((f) => (
                  <div key={f.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                    <p className="text-zinc-200 text-sm leading-relaxed">
                      {f.commitment_text}
                      {f.goal_title && (
                        <span className="text-zinc-500">
                          {' '}— related to your {f.goal_title} goal
                          {f.goal_why && `, it was important because ${f.goal_why}`}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                No missed commitments in your last 3 sessions.
              </p>
            )}
          </section>

          {/* ── ZONE 2: Progress & Identity ───────────────────────────────── */}

          {/* Section: Your Goals */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold text-base">Your Goals</h2>
              <button
                onClick={() => setShowAddGoal((v) => !v)}
                className="text-zinc-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
              >
                + Add
              </button>
            </div>

            {/* Inline add-goal form */}
            {showAddGoal && (
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 mb-3 space-y-3">
                <input
                  type="text"
                  value={newGoalTitle}
                  onChange={(e) => setNewGoalTitle(e.target.value)}
                  placeholder="Goal title"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
                <textarea
                  value={newGoalBaseline}
                  onChange={(e) => setNewGoalBaseline(e.target.value)}
                  placeholder="Where are you starting from? (optional)"
                  rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveGoal}
                    disabled={!newGoalTitle.trim() || savingGoal}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    {savingGoal ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setShowAddGoal(false); setNewGoalTitle(''); setNewGoalBaseline(''); }}
                    className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-zinc-600 text-xs">Your coach will ask why this matters in your next session.</p>
              </div>
            )}

            {activeGoals.length === 0 && !showAddGoal && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <p className="text-zinc-500 text-sm">No active goals yet. Add one and your coach will help you understand why it matters.</p>
              </div>
            )}

            {activeGoals.length > 0 && (
              <div className="space-y-3">
                {activeGoals.map((goal, i) => {
                  const whysList = Array.isArray(goal.whys) && goal.whys.length > 0
                    ? [...goal.whys].reverse()
                    : [];

                  const signal = goal.last_motivation_signal;
                  const signalBadge = (() => {
                    if (signal === 'strong')     return { dot: 'bg-green-500',  text: 'Strong momentum' };
                    if (signal === 'medium')     return { dot: 'bg-yellow-400', text: 'Building' };
                    if (signal === 'low')        return { dot: 'bg-orange-500', text: 'Needs attention' };
                    if (signal === 'struggling') return { dot: 'bg-red-500',    text: 'Struggling' };
                    return null;
                  })();
                  const isMenuOpen = openGoalMenu === goal.id;
                  const isLoading = goalActionLoading === goal.id;

                  return (
                    <div
                      key={goal.id || i}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg mt-0.5 self-start">🎯</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium text-sm leading-snug">{goal.title}</p>
                          {signalBadge && (
                            <span className="inline-flex mt-1 items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-zinc-400">
                              <span className={`w-1.5 h-1.5 rounded-full ${signalBadge.dot}`} />
                              {signalBadge.text}
                            </span>
                          )}

                          {goal.baseline_snapshot && (
                            <p className="text-zinc-500 text-xs mt-1 leading-relaxed">
                              Started:{' '}
                              <span className="text-zinc-400">{goal.baseline_snapshot}</span>
                              {goal.baseline_date && (
                                <span className="text-zinc-600 ml-1">
                                  · {new Date(goal.baseline_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                </span>
                              )}
                            </p>
                          )}

                          {whysList.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              <p className="text-zinc-500 text-xs uppercase tracking-widest">Why this matters</p>
                              {whysList.map((w, j) => (
                                <div key={j} className="flex items-start gap-1.5">
                                  <span className="text-zinc-600 text-xs mt-0.5 flex-shrink-0">"</span>
                                  <p className="text-zinc-400 text-xs leading-relaxed italic flex-1">
                                    {w.text}
                                    {w.added_at && (
                                      <span className="text-zinc-600 not-italic ml-1">
                                        · {new Date(w.added_at + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}

                          {whysList.length === 0 && (
                            <p className="text-zinc-600 text-xs mt-1 italic">No why yet — talk about this in your next session</p>
                          )}
                        </div>
                        <div className="relative self-center" data-goal-menu-root="true">
                          <button
                            onClick={() => setOpenGoalMenu(isMenuOpen ? null : goal.id)}
                            disabled={isLoading}
                            className="text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Goal actions"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          {isMenuOpen && (
                            <div className="absolute right-0 top-full mt-1 z-10 bg-zinc-800 border border-zinc-700 rounded-xl shadow-lg overflow-hidden min-w-[130px]">
                              <button
                                onClick={() => {
                                  setOpenGoalMenu(null);
                                  handleArchiveGoal(goal.id);
                                }}
                                className="w-full text-left text-sm px-4 py-2 hover:bg-zinc-700 transition-colors text-zinc-200"
                              >
                                Archive
                              </button>
                              <button
                                onClick={() => {
                                  setOpenGoalMenu(null);
                                  handleDeleteGoal(goal.id);
                                }}
                                className="w-full text-left text-sm px-4 py-2 hover:bg-zinc-700 transition-colors text-red-400 hover:text-red-300"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {archivedGoals.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {showArchived ? 'Hide archived' : `Show archived (${archivedGoals.length})`}
                </button>
              </div>
            )}

            {showArchived && (
              <div className="mt-3">
                {archivedGoals.length === 0 ? (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <p className="text-zinc-500 text-sm">No archived goals yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {archivedGoals.map((goal, i) => {
                      const statusLabel = goal.status === 'achieved' ? 'Achieved' : goal.status === 'paused' ? 'Paused' : 'Archived';
                      const statusColor = goal.status === 'achieved' ? 'text-green-500' : 'text-zinc-500';
                      const isMenuOpen = openGoalMenu === goal.id;
                      const isLoading = goalActionLoading === goal.id;

                      return (
                        <div key={goal.id || i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 opacity-80">
                          <div className="flex items-start gap-3">
                            <span className="text-lg mt-0.5 self-start">🎯</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-zinc-300 font-medium text-sm leading-snug">{goal.title}</p>
                              <p className={`text-xs mt-0.5 ${statusColor}`}>{statusLabel}</p>
                              {goal.baseline_snapshot && (
                                <p className="text-zinc-600 text-xs mt-1 leading-relaxed">
                                  Started: <span className="text-zinc-500">{goal.baseline_snapshot}</span>
                                </p>
                              )}
                            </div>
                            <div className="relative self-center" data-goal-menu-root="true">
                              <button
                                onClick={() => setOpenGoalMenu(isMenuOpen ? null : goal.id)}
                                disabled={isLoading}
                                className="text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                aria-label="Goal actions"
                              >
                                <MoreHorizontal size={18} />
                              </button>
                              {isMenuOpen && (
                                <div className="absolute right-0 top-full mt-1 z-10 bg-zinc-800 border border-zinc-700 rounded-xl shadow-lg overflow-hidden min-w-[130px]">
                                  <button
                                    onClick={() => {
                                      setOpenGoalMenu(null);
                                      handleReactivateGoal(goal.id);
                                    }}
                                    className="w-full text-left text-sm px-4 py-2 hover:bg-zinc-700 transition-colors text-zinc-200"
                                  >
                                    Activate
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenGoalMenu(null);
                                      handleDeleteGoal(goal.id);
                                    }}
                                    className="w-full text-left text-sm px-4 py-2 hover:bg-zinc-700 transition-colors text-red-400 hover:text-red-300"
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Bottom padding */}
          <div className="h-6" />

        </div>
      </div>
    </AppShellV2>
  );
}
