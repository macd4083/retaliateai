import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
  const [visibleCount, setVisibleCount]           = useState(5);
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

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([
        loadSessions(),
        loadStreak(),
        loadCommitmentStats(),
        loadActiveGoals(),
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
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(5);
    setActiveGoals(data || []);
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

  // Commitment list: filter to selected week for non-current weeks
  const displayedCommitments = (() => {
    if (isCurrentWeekSelected) {
      return allCommitments.slice(0, visibleCount);
    }
    const weeksBack  = weeklyData.length - 1 - activeWeekIndex;
    const todayStr   = localDateStr(0);
    const todayMonday = getMondayOf(todayStr);
    const wStart     = addDays(todayMonday, -weeksBack * 7);
    const wEnd       = addDays(wStart, 6);
    return allCommitments.filter((c) => c.date >= wStart && c.date <= wEnd);
  })();
  const commitmentsWithTextOnly = displayedCommitments.filter((c) => c.commitment !== null);

  const showLoadMore = isCurrentWeekSelected && commitmentsWithTextOnly.length > visibleCount;

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

              const lineParts = weekDays.map((d, i) => {
                const x = getX(i).toFixed(1);
                const y = getY(d.score).toFixed(1);
                return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
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
                  <p className="text-center text-zinc-500 text-xs mb-1">{selectedWeek?.weekLabel} week</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goToWeek(Math.max(0, activeWeekIndex - 1))}
                      disabled={activeWeekIndex === 0}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-lg"
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
                                {isSelected && (
                                  <>
                                    <rect
                                      x={x - 12}
                                      y={y - 20}
                                      width={24}
                                      height={15}
                                      rx={6}
                                      fill="#27272a"
                                      stroke="#3f3f46"
                                      strokeWidth={1}
                                    />
                                    <text
                                      x={x}
                                      y={y - 10}
                                      textAnchor="middle"
                                      fill="white"
                                      fontSize={9}
                                      fontWeight="bold"
                                      fontFamily="sans-serif"
                                    >
                                      {d.score != null ? Math.round(d.score) : '–'}
                                    </text>
                                  </>
                                )}
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
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-lg"
                    >
                      ›
                    </button>
                  </div>
                </>
              );
            })() : null}
          </div>

          {/* Right: Commitment list */}
          <div>
            <h2 className="text-white font-semibold text-base mb-3">Commitments</h2>
            <div className="space-y-2">
              {commitmentsWithTextOnly.length === 0 ? (
                <p className="text-zinc-500 text-sm">
                  {isCurrentWeekSelected
                    ? 'No commitments yet. Start a reflection tonight.'
                    : 'No commitments this week.'}
                </p>
              ) : (
                commitmentsWithTextOnly.map((c, i) => (
                    <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 mt-0.5">
                          {c.status === 'kept'   ? '✅' :
                           c.status === 'missed' ? '❌' : '⏳'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-zinc-200 text-sm leading-snug">{c.commitment}</p>
                          {c.minimum && (
                            <p className="text-zinc-600 text-xs mt-0.5">
                              <span className="text-zinc-500">Minimum:</span> {c.minimum}
                            </p>
                          )}
                          {c.stretch && (
                            <p className="text-zinc-600 text-xs mt-0.5">
                              <span className="text-zinc-500">Stretch:</span> {c.stretch}
                            </p>
                          )}
                          <p className="text-zinc-500 text-xs mt-0.5">
                            {formatDate(c.date)} ·{' '}
                            {c.status === 'kept'   ? 'Kept' :
                           c.status === 'missed' ? 'Missed' :
                           'Pending — check back tomorrow'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {showLoadMore && (
                <button
                  onClick={() => setVisibleCount((c) => c + 5)}
                  className="mt-1 text-zinc-400 text-sm flex items-center gap-1 hover:text-white transition-colors"
                >
                  Show more <ChevronDown size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Section 2: Streak */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-white font-semibold text-lg">{streak} night streak</p>
              <p className="text-zinc-500 text-sm">Keep showing up.</p>
            </div>
          </div>

          {/* ── ZONE 2: Progress & Identity ───────────────────────────────── */}

          {/* Section 4: Your Goals */}
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

                  return (
                    <div
                      key={goal.id || i}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg mt-0.5">🎯</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-white font-medium text-sm leading-snug">{goal.title}</p>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {signalBadge && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-zinc-400">
                                  <span className={`w-1.5 h-1.5 rounded-full ${signalBadge.dot}`} />
                                  {signalBadge.text}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Baseline snapshot */}
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

                          {/* Whys list */}
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
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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
                  <div key={f.id} className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-zinc-600 rounded-xl px-4 py-3">
                    <p className="text-zinc-200 text-sm leading-relaxed">
                      {f.commitment_text}
                      {f.goal_title && (
                        <span className="text-zinc-500">
                          {' '}— related to your {f.goal_title} goal
                          {f.goal_why && `, it was important because ${f.goal_why}`}
                        </span>
                      )}
                    </p>
                    <p className="text-zinc-500 text-xs mt-2 italic">
                      Hey, I noticed you missed this — think about how you can better prioritize it throughout your day.
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

          {/* Bottom padding */}
          <div className="h-6" />

        </div>
      </div>
    </AppShellV2>
  );
}
