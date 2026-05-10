import React, { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';

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

function getMondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(y, m - 1, d - offset);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function weekdayIndexFromDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 6 : day - 1;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InsightsV2() {
  const { user } = useAuth();

  const [allCommitments, setAllCommitments]       = useState([]);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(null);
  const [selectedDayIndex, setSelectedDayIndex]   = useState(null);
  const [slideDir, setSlideDir]                   = useState(null);
  const [chartOffset, setChartOffset]             = useState(0);
  const [streak, setStreak]                       = useState(0);
  const [commitmentStats, setCommitmentStats]     = useState(null);
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
    try {
      const res = await fetch('/api/commitment-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setCommitmentStats(data);
      }
    } catch (_e) {}
  }

  if (loading) {
    return (
      <AppShellV2 title="Insights">
        <div className="h-full overflow-y-auto flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
        </div>
      </AppShellV2>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const weeklyData = commitmentStats?.weeklyData || [];

  // Selected week defaults to the most recent (last index)
  const activeWeekIndex      = selectedWeekIndex !== null ? selectedWeekIndex : Math.max(0, weeklyData.length - 1);
  const selectedWeek         = weeklyData[activeWeekIndex] ?? null;
  const isCurrentWeekSelected = weeklyData.length === 0 || activeWeekIndex === weeklyData.length - 1;

  function goToWeek(newIndex) {
    if (newIndex < 0 || newIndex >= weeklyData.length || newIndex === activeWeekIndex) return;
    const dir = newIndex > activeWeekIndex ? -1 : 1;
    setSlideDir(dir < 0 ? 'left' : 'right');
    setChartOffset(dir * 100);
    setSelectedWeekIndex(newIndex);
    setSelectedDayIndex(null);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setChartOffset(0);
      });
    });
  }

  const yesterday = addDays(localDateStr(0), -1);
  const yesterdayCommitment = allCommitments.find((c) => c.date === yesterday && c.commitment !== null) || null;

  const keptFragments   = fragmentHistory.filter((f) => f.kept === true);
  const missedFragments = fragmentHistory.filter((f) => f.kept === false);

  return (
    <AppShellV2 title="Insights">
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">

          {/* ── ZONE 1: Momentum ──────────────────────────────────────────── */}

          {/* Section 1: Consistency Tracker */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-white font-semibold text-lg mb-4">Consistency Tracker</p>

            {weeklyData.length > 0 ? (() => {
              const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
              const padX     = 28;
              const baseline = 88;
              const chartTop = 12;
              const chartH   = baseline - chartTop;
              const totalW   = 320;
              const xStep    = (totalW - 2 * padX) / 6;

              function getX(i) { return padX + i * xStep; }
              function getY(score) {
                return score === null ? baseline : baseline - (score / 100) * chartH;
              }

              const thisMonday = getMondayOf(localDateStr(0));
              const weeksBack = weeklyData.length - 1 - activeWeekIndex;
              const wStart = addDays(thisMonday, -weeksBack * 7);
              const weekDays = Array.from({ length: 7 }, (_, d) => {
                const date = addDays(wStart, d);
                const commitment = allCommitments.find((c) => c.date === date) || null;
                return {
                  date,
                  label: dayLabels[d],
                  score: commitment?.score ?? null,
                  status: commitment?.status ?? null,
                  hasCommitment: commitment !== null,
                };
              });

              const todayStr = localDateStr(0);
              const lineParts = [];
              weekDays.forEach((d, i) => {
                if (d.score === null || d.date > todayStr) return;
                const x = getX(i).toFixed(1);
                const y = getY(d.score).toFixed(1);
                lineParts.push(lineParts.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
              });

              const todayWeekdayIndex = weekdayIndexFromDateStr(localDateStr(0));
              const lastDayWithCommitment = (() => {
                for (let i = 6; i >= 0; i -= 1) {
                  if (weekDays[i].hasCommitment) return i;
                }
                return -1;
              })();
              const resolvedDayIndex = selectedDayIndex !== null
                ? Math.max(0, Math.min(6, selectedDayIndex))
                : isCurrentWeekSelected
                  ? todayWeekdayIndex
                  : (lastDayWithCommitment !== -1 ? lastDayWithCommitment : 6);

              function dotColor(day, isSelected) {
                if (!day.hasCommitment) return '#27272a';
                if (day.status === 'missed') return '#52525b';
                if (day.status === 'pending') return '#f97316';
                if (day.status === 'kept') {
                  if (isSelected) return '#ef4444';
                  if (day.score != null && day.score >= 80) return '#fb7185';
                  if (day.score != null && day.score >= 60) return '#fdba74';
                  return '#fca5a5';
                }
                return '#71717a';
              }

              return (
                <>
                  <p className="text-center text-zinc-300 text-sm font-medium mb-2">{selectedWeek?.weekLabel} week</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goToWeek(Math.max(0, activeWeekIndex - 1))}
                      disabled={activeWeekIndex === 0}
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-zinc-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-3xl"
                    >
                      ‹
                    </button>

                    <div className="flex-1 overflow-hidden min-h-[80px]">
                      <div
                        key={activeWeekIndex}
                        data-slide-dir={slideDir || 'none'}
                        onTransitionEnd={() => setSlideDir(null)}
                        style={{
                          transform: `translateX(${chartOffset}%)`,
                          transition: chartOffset === 0 && slideDir ? 'transform 0.3s ease' : 'none',
                        }}
                      >
                        <svg viewBox="0 0 320 120" className="w-full mb-1">
                          <text x={padX - 4} y={chartTop + 7} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="sans-serif">100</text>
                          <text x={padX - 4} y={getY(50) + 4} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="sans-serif">50</text>
                          <text x={padX - 4} y={baseline} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="sans-serif">0</text>
                          <line x1={padX} y1={baseline} x2={totalW - padX} y2={baseline}
                            stroke="#3f3f46" strokeWidth={1} strokeDasharray="3 3" />
                          <line x1={padX} y1={getY(50)} x2={totalW - padX} y2={getY(50)}
                            stroke="#27272a" strokeWidth={1} strokeDasharray="2 4" />
                          <line x1={padX} y1={chartTop} x2={totalW - padX} y2={chartTop}
                            stroke="#27272a" strokeWidth={1} strokeDasharray="2 4" />
                          <path d={lineParts.join(' ')} fill="none" stroke="#52525b" strokeWidth={0.8} />
                          {weekDays.map((d, i) => {
                            const x = getX(i);
                            const y = getY(d.score);
                            const isSelected = i === resolvedDayIndex;
                            return (
                              <g
                                key={d.date}
                                onClick={() => setSelectedDayIndex(i)}
                                tabIndex={0}
                                onFocus={() => setSelectedDayIndex(i)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedDayIndex(i);
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <circle cx={x} cy={y} r={isSelected ? 3 : 2} fill={dotColor(d, isSelected)} />
                                <text
                                  x={x}
                                  y={112}
                                  textAnchor="middle"
                                  fill={isSelected ? '#ef4444' : '#52525b'}
                                  fontSize={8}
                                  fontFamily="sans-serif"
                                >
                                  {d.label}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    </div>

                    <button
                      onClick={() => goToWeek(Math.min(weeklyData.length - 1, activeWeekIndex + 1))}
                      disabled={activeWeekIndex === weeklyData.length - 1}
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-zinc-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-3xl"
                    >
                      ›
                    </button>
                  </div>
                </>
              );
            })() : null}
          </div>

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
