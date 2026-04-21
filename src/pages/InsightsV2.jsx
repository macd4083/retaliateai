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

function formatInsightDate(dateStr) {
  if (!dateStr) return '';
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ─── Main Component ────────────────────────────────────��──────────────────────

// Returns true if an array has at least one object item with an evidence field
function hasEvidenceItems(items) {
  return Array.isArray(items) && items.some((item) => typeof item === 'object' && item?.evidence);
}

const COMMITMENT_SCORE_EXCEPTIONAL_THRESHOLD = 90;
const COMMITMENT_SCORE_GOOD_THRESHOLD = 75;
const COMMITMENT_SCORE_RAISE_BAR_THRESHOLD = 80;
const COMMITMENT_SCORE_SOLID_THRESHOLD = 60;

export default function InsightsV2() {
  const { user } = useAuth();

  const [livingProfile, setLivingProfile]       = useState(null);
  const [allCommitments, setAllCommitments]       = useState([]);
  const [visibleCount, setVisibleCount]           = useState(5);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(null);
  const [selectedDayIndex, setSelectedDayIndex]   = useState(null);
  const [slideDir, setSlideDir]                   = useState(null);
  const [chartOffset, setChartOffset]             = useState(0);
  const [gaugeAnimatedFrac, setGaugeAnimatedFrac] = useState(0);
  const [wins, setWins]                           = useState([]);
  const [narratives, setNarratives]               = useState([]);
  const [streak, setStreak]                       = useState(0);
  const [commitmentStats, setCommitmentStats]     = useState(null);
  const [loading, setLoading]                     = useState(true);
  const [activeGoals, setActiveGoals]             = useState([]);
  const [showAddGoal, setShowAddGoal]             = useState(false);
  const [newGoalTitle, setNewGoalTitle]           = useState('');
  const [newGoalCategory, setNewGoalCategory]     = useState('');
  const [newGoalBaseline, setNewGoalBaseline]     = useState('');
  const [savingGoal, setSavingGoal]               = useState(false);
  const [progressEvents, setProgressEvents]       = useState([]);
  const weeklyDataForGauge                         = commitmentStats?.weeklyData || [];
  const activeGaugeWeekIndex                      = selectedWeekIndex !== null
    ? selectedWeekIndex
    : Math.max(0, weeklyDataForGauge.length - 1);
  const gScoreForEffect                            = weeklyDataForGauge[activeGaugeWeekIndex]?.avgScore ?? null;

  useEffect(() => {
    if (!user?.id) return;
    loadData();
  }, [user?.id]);

  useEffect(() => {
    const targetFillFrac = gScoreForEffect != null ? Math.max(0, Math.min(gScoreForEffect / 100, 1)) : 0;
    setGaugeAnimatedFrac(0);
    const timeout = setTimeout(() => {
      setGaugeAnimatedFrac(targetFillFrac);
    }, 50);
    return () => clearTimeout(timeout);
  }, [activeGaugeWeekIndex, gScoreForEffect]);

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([
        loadProfile(),
        loadSessions(),
        loadStreak(),
        loadCommitmentStats(),
        loadNarratives(),
        loadActiveGoals(),
        loadProgressEvents(),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadActiveGoals() {
    const { data } = await supabase
      .from('goals')
      .select('id, title, category, whys, status, created_at, vision_snapshot, last_mentioned_at, last_motivation_signal, baseline_snapshot, baseline_date')
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
        category: newGoalCategory || null,
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
      setNewGoalCategory('');
      setNewGoalBaseline('');
      setShowAddGoal(false);
      await loadActiveGoals();
    } finally {
      setSavingGoal(false);
    }
  }

  async function loadProfile() {
    const { data } = await supabase
      .from('user_profiles')
      .select('short_term_state, strengths, values, identity_statement, growth_areas, long_term_patterns, profile_updated_at')
      .eq('id', user.id)
      .maybeSingle();
    setLivingProfile(data);
  }

  // Intentionally does not select reflection_streak — live streak is computed in loadStreak() via reflectionHelpers.getReflectionStreak()
  async function loadSessions() {
    const today = localDateStr(0);

    // Fetch all sessions with a commitment (desc, up to 100)
    const { data: allWithCommitment } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, commitment_minimum, commitment_stretch, commitment_score, is_complete')
      .eq('user_id', user.id)
      .not('tomorrow_commitment', 'is', null)
      .order('date', { ascending: false })
      .limit(100);

    // Include as a commitment row only if complete OR date is before today
    const eligibleCommitments = (allWithCommitment || []).filter(
      (s) => s.is_complete || s.date < today
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
        const nextDay = addDays(s.date, 1);
        const isNewest = idx === 0;
        const status = isNewest
          ? (sessionsByDate[nextDay]?.is_complete ? 'kept' : 'pending')
          : (sessionsByDate[nextDay]?.is_complete ? 'kept' : 'missed');
        return {
          date: s.date,
          commitment: s.tomorrow_commitment,
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

    // Wins from last 7 sessions
    const { data: recentSessions } = await supabase
      .from('reflection_sessions')
      .select('date, wins')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(7);

    const allWins = [];
    for (const session of recentSessions || []) {
      if (Array.isArray(session.wins)) {
        for (const win of session.wins) {
          const text = typeof win === 'string' ? win : win?.text;
          if (text) allWins.push({ text, date: session.date });
        }
      }
    }
    setWins(allWins.slice(0, 20));
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

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function loadNarratives() {
    try {
      const res = await fetch('/api/synthesize-insights', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ user_id: user.id, return_as_narratives: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setNarratives(data.narratives || []);
      }
    } catch (_e) {}
  }

  async function loadProgressEvents() {
    try {
      const { data } = await supabase
        .from('user_progress_events')
        .select('id, event_type, payload, created_at')
        .eq('user_id', user.id)
        // No surfaced_at filter — show all recent events regardless of surfacing status
        .order('created_at', { ascending: false })
        .limit(7);
      setProgressEvents(data || []);
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

  const avgScore7 = commitmentStats?.avgScore7 ?? null;
  const trajectory = commitmentStats?.trajectory;
  const weeklyData = commitmentStats?.weeklyData || [];

  // Selected week defaults to the most recent (last index)
  const activeWeekIndex      = selectedWeekIndex !== null ? selectedWeekIndex : Math.max(0, weeklyData.length - 1);
  const selectedWeek         = weeklyData[activeWeekIndex] ?? null;
  const isCurrentWeekSelected = weeklyData.length === 0 || activeWeekIndex === weeklyData.length - 1;

  function trajectoryLine() {
    if (avgScore7 == null) return 'Keep showing up — more data coming.';
    if (trajectory === 'improving') return 'Score trending up — keep building.';
    if (trajectory === 'declining') return 'Score trending down. Worth paying attention to.';
    return 'Consistent with last week.';
  }

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

  const showLoadMore = isCurrentWeekSelected && allCommitments.length > visibleCount;

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
              const padX     = 20;
              const baseline = 70;
              const chartTop = 10;
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

              // ── Half-circle gauge: avg score / 100 ─────────────────────
              const cx       = 100;
              const cy       = 108;
              const r        = 78;
              const halfCirc = Math.PI * r;
              const fullCirc = 2 * Math.PI * r;

              const gScore = selectedWeek?.avgScore ?? null;
              const fillLen = gaugeAnimatedFrac * halfCirc;
              const fillColor = gScore == null ? '#52525b' : gScore >= 80 ? '#dc2626' : gScore >= 60 ? '#f97316' : '#71717a';

              const weekDescText = gScore == null
                ? 'No scored commitments this week.'
                : gScore >= 80
                  ? `Strong week — avg score ${Math.round(gScore)}/100.`
                  : gScore >= 60
                    ? `Solid week — avg score ${Math.round(gScore)}/100.`
                    : gScore >= 40
                      ? `Avg score ${Math.round(gScore)}/100 this week.`
                      : `Tough week — avg score ${Math.round(gScore)}/100.`;

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

                    <div className="flex-1 overflow-hidden">
                      <div
                        key={activeWeekIndex}
                        data-slide-dir={slideDir || 'none'}
                        onTransitionEnd={() => setSlideDir(null)}
                        style={{
                          transform: `translateX(${chartOffset}%)`,
                          transition: chartOffset === 0 && slideDir ? 'transform 0.3s ease' : 'none',
                        }}
                      >
                        <svg viewBox="0 0 320 100" className="w-full mb-1">
                          <text x={padX - 4} y={chartTop + 4} textAnchor="end" fill="#71717a" fontSize={5} fontFamily="sans-serif">100</text>
                          <text x={padX - 4} y={getY(50) + 3} textAnchor="end" fill="#71717a" fontSize={5} fontFamily="sans-serif">50</text>
                          <text x={padX - 4} y={baseline} textAnchor="end" fill="#71717a" fontSize={5} fontFamily="sans-serif">0</text>
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
                                      y={y - 17}
                                      width={24}
                                      height={13}
                                      rx={6}
                                      fill="#27272a"
                                      stroke="#3f3f46"
                                      strokeWidth={1}
                                    />
                                    <text
                                      x={x}
                                      y={y - 8}
                                      textAnchor="middle"
                                      fill="white"
                                      fontSize={6}
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
                                  y={95}
                                  textAnchor="middle"
                                  fill={isSelected ? '#ef4444' : '#52525b'}
                                  fontSize={5}
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

                  {/* Half-circle gauge */}
                  <div className="flex justify-center mt-2">
                    <svg width="200" height="120" viewBox="0 0 200 120">
                      {/* Track */}
                      <circle cx={cx} cy={cy} r={r}
                        fill="none" stroke="#27272a" strokeWidth={16}
                        strokeDasharray={`${halfCirc} ${fullCirc}`}
                        strokeDashoffset={0}
                        strokeLinecap="round"
                        transform={`rotate(180 ${cx} ${cy})`}
                      />
                      {/* Fill */}
                      <circle cx={cx} cy={cy} r={r}
                        fill="none" stroke={fillColor} strokeWidth={16}
                        strokeDasharray={`${fillLen} ${fullCirc}`}
                        strokeDashoffset={0}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 0.6s ease' }}
                        transform={`rotate(180 ${cx} ${cy})`}
                      />
                      {/* Centre label */}
                      <text x={cx} y={cy - 14} textAnchor="middle"
                        fill="white" fontSize={26} fontWeight="bold" fontFamily="sans-serif">
                        {gScore != null ? Math.round(gScore) : '–'}
                      </text>
                      <text x={cx} y={cy + 22} textAnchor="middle"
                        fill="#52525b" fontSize={9} fontFamily="sans-serif">
                        {selectedWeek?.weekLabel ?? 'this week'}
                      </text>
                    </svg>
                  </div>

                  {/* Trajectory line */}
                  <p className="text-zinc-500 text-xs mt-3">{trajectoryLine()}</p>

                  {commitmentStats?.avgScore7 != null && (
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-zinc-400 text-xs">Avg commitment score</p>
                        <span className={`text-sm font-bold ${
                          commitmentStats.avgScore7 >= COMMITMENT_SCORE_RAISE_BAR_THRESHOLD ? 'text-red-400' :
                          commitmentStats.avgScore7 >= COMMITMENT_SCORE_SOLID_THRESHOLD ? 'text-orange-400' : 'text-zinc-400'
                        }`}>
                          {Math.round(commitmentStats.avgScore7)}/100
                        </span>
                      </div>
                      <p className="text-zinc-600 text-xs">
                        {commitmentStats.scoreTrajectory === 'improving' ? '↑ Improving from last week' :
                         commitmentStats.scoreTrajectory === 'declining' ? '↓ Declining from last week' :
                         'Consistent with last week'}
                      </p>
                    </div>
                  )}

                  {commitmentStats?.avgScore7 >= COMMITMENT_SCORE_RAISE_BAR_THRESHOLD && (
                    <div className="mt-3 p-3 bg-red-950/30 border border-red-900/40 rounded-xl">
                      <p className="text-red-400 text-xs font-semibold mb-1">⚡ Time to raise the bar</p>
                      <p className="text-zinc-400 text-xs leading-relaxed">
                        Your score has averaged {Math.round(commitmentStats.avgScore7)} — you're consistently hitting your stretch goals. Your coach will push you to raise the ceiling in your next session.
                      </p>
                    </div>
                  )}

                  {/* Week description */}
                  <p className="text-zinc-400 text-xs mt-1">{weekDescText}</p>
                </>
              );
            })() : (
              <p className="text-zinc-500 text-sm">
                No data yet. Start reflecting to see your consistency over time.
              </p>
            )}
          </div>

          {/* Right: Commitment list */}
          <div>
            <h2 className="text-white font-semibold text-base mb-3">Commitments</h2>
            <div className="space-y-2">
              {displayedCommitments.length === 0 ? (
                <p className="text-zinc-500 text-sm">
                  {isCurrentWeekSelected
                    ? 'No commitments yet. Start a reflection tonight.'
                    : 'No commitments this week.'}
                </p>
              ) : (
                displayedCommitments.map((c, i) => (
                    <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 mt-0.5">
                          {c.status === 'kept'   ? '✅' :
                           c.status === 'missed' ? '❌' : '⏳'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <p className="text-zinc-200 text-sm leading-snug">{c.commitment}</p>
                            {c.score != null && (
                              <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                c.score >= COMMITMENT_SCORE_EXCEPTIONAL_THRESHOLD ? 'bg-red-900/50 text-red-300 border border-red-700' :
                                c.score >= COMMITMENT_SCORE_GOOD_THRESHOLD ? 'bg-orange-900/50 text-orange-300 border border-orange-700' :
                                c.score >= COMMITMENT_SCORE_SOLID_THRESHOLD ? 'bg-zinc-800 text-zinc-300 border border-zinc-600' :
                                'bg-zinc-900 text-zinc-500 border border-zinc-700'
                              }`}>
                                {c.score}/100
                              </span>
                            )}
                          </div>
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

          {/* Section 3: Recent Progress (wins + progress events combined) */}
          {(() => {
            const winItems = wins.map((w) => ({
              type: 'win',
              text: w.text,
              date: w.date,
              id: `win-${w.date}-${w.text}`,
              signal: null,
            }));
            const eventItems = progressEvents.map((e) => ({
              type: e.event_type,
              text: e.payload?.display_text,
              date: e.created_at,
              id: e.id,
              signal: e.payload?.new_signal,
            }));
            const combined = [...winItems, ...eventItems]
              .filter((item) => item.text)
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .slice(0, 8);

            const getBorderColor = (type, signal) => {
              if (type === 'win') return 'border-l-green-600';
              if (type === 'followthrough_milestone') return 'border-l-red-600';
              if (type === 'motivation_signal_change') {
                if (signal === 'strong') return 'border-l-green-600';
                if (signal === 'low') return 'border-l-orange-500';
                if (signal === 'struggling') return 'border-l-red-600';
                return 'border-l-zinc-500';
              }
              return 'border-l-zinc-500';
            };

            const getIcon = (type, signal) => {
              if (type === 'win') return '✅';
              if (type === 'followthrough_milestone') return '🔥';
              if (type === 'motivation_signal_change') {
                return (signal === 'strong' || signal === 'medium') ? '📈' : '📉';
              }
              if (type === 'blocker_fading') return '💡';
              if (type === 'foothold_unlocked') return '🔓';
              return '📌';
            };

            const formatEventDate = (dateStr) => {
              if (!dateStr) return '';
              const d = new Date(dateStr);
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            };

            return (
              <section>
                <h2 className="text-white font-semibold text-base mb-3">Recent Progress</h2>
                {combined.length > 0 ? (
                  <div className="space-y-2">
                    {combined.map((item) => (
                      <div
                        key={item.id}
                        className={`bg-zinc-900 border border-zinc-800 border-l-4 ${getBorderColor(item.type, item.signal)} rounded-2xl px-4 py-3 flex items-start gap-3`}
                      >
                        <span className="text-sm flex-shrink-0 mt-0.5">{getIcon(item.type, item.signal)}</span>
                        <div className="min-w-0">
                          <p className="text-zinc-200 text-sm leading-relaxed">{item.text}</p>
                          <p className="text-zinc-500 text-xs mt-0.5">{formatEventDate(item.date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    Your wins and progress milestones will appear here after a few sessions.
                  </p>
                )}
              </section>
            );
          })()}

          {/* Section 3b: What's Shifting (progress event threshold crossings) */}
          {progressEvents.length > 0 && (() => {
            const getEventIcon = (type, payload) => {
              if (type === 'followthrough_milestone') return '🔥';
              if (type === 'motivation_signal_change') {
                const to = payload?.to;
                return (to === 'strong' || to === 'medium') ? '📈' : '📉';
              }
              if (type === 'blocker_fading') return '💡';
              if (type === 'strength_resolved') return '⭐';
              if (type === 'growth_area_resolved') return '🌱';
              if (type === 'foothold_unlocked') return '🔓';
              if (type === 'first_depth_insight') return '🧠';
              return '📌';
            };

            const getEventBorder = (type, payload) => {
              if (type === 'followthrough_milestone') return 'border-l-red-600';
              if (type === 'motivation_signal_change') {
                const to = payload?.to;
                if (to === 'strong') return 'border-l-green-600';
                if (to === 'low' || to === 'struggling') return 'border-l-orange-500';
                return 'border-l-zinc-500';
              }
              if (type === 'blocker_fading') return 'border-l-yellow-500';
              if (type === 'strength_resolved') return 'border-l-emerald-500';
              if (type === 'growth_area_resolved') return 'border-l-teal-500';
              if (type === 'foothold_unlocked') return 'border-l-blue-500';
              if (type === 'first_depth_insight') return 'border-l-purple-500';
              return 'border-l-zinc-500';
            };

            const getEventLabel = (type) => {
              if (type === 'followthrough_milestone') return 'Commitment milestone';
              if (type === 'motivation_signal_change') return 'Momentum shift';
              if (type === 'blocker_fading') return 'Pattern fading';
              if (type === 'strength_resolved') return 'Strength solidifying';
              if (type === 'growth_area_resolved') return 'Growth achieved';
              if (type === 'foothold_unlocked') return "Something's changing";
              if (type === 'first_depth_insight') return 'First real insight';
              return 'Progress marker';
            };

            const formatEvtDate = (dateStr) => {
              if (!dateStr) return '';
              const d = new Date(dateStr);
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            };

            return (
              <section>
                <h2 className="text-white font-semibold text-base mb-3">What's Shifting</h2>
                <div className="space-y-2">
                  {progressEvents.map((e) => {
                    const displayText = e.payload?.display_text;
                    if (!displayText) return null;
                    return (
                      <div
                        key={e.id}
                        className={`bg-zinc-900 border border-zinc-800 border-l-4 ${getEventBorder(e.event_type, e.payload)} rounded-2xl px-4 py-3 flex items-start gap-3`}
                      >
                        <span className="text-sm flex-shrink-0 mt-0.5">{getEventIcon(e.event_type, e.payload)}</span>
                        <div className="min-w-0">
                          <p className="text-zinc-500 text-xs uppercase tracking-widest mb-1">{getEventLabel(e.event_type)}</p>
                          <p className="text-zinc-200 text-sm leading-relaxed">{displayText}</p>
                          <p className="text-zinc-500 text-xs mt-0.5">{formatEvtDate(e.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

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
                <select
                  value={newGoalCategory}
                  onChange={(e) => setNewGoalCategory(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-zinc-500"
                >
                  <option value="">Category (optional)</option>
                  <option value="health">Health</option>
                  <option value="career">Career</option>
                  <option value="relationships">Relationships</option>
                  <option value="finances">Finances</option>
                  <option value="learning">Learning</option>
                  <option value="creativity">Creativity</option>
                  <option value="mindset">Mindset</option>
                  <option value="other">Other</option>
                </select>
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
                    onClick={() => { setShowAddGoal(false); setNewGoalTitle(''); setNewGoalCategory(''); setNewGoalBaseline(''); }}
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
                              {goal.category && (
                                <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs">
                                  {goal.category.replace('_', ' ')}
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

                          {/* Vision snapshot */}
                          {goal.vision_snapshot && (
                            <div className="mt-2 pt-2 border-t border-zinc-800">
                              <p className="text-zinc-500 text-xs uppercase tracking-widest mb-1">Vision</p>
                              <p className="text-zinc-500 text-xs leading-relaxed italic">
                                &ldquo;{goal.vision_snapshot}&rdquo;
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section 5: Who You're Becoming (with inline strengths + growth areas) */}
          {livingProfile?.identity_statement && (
            <div className="bg-gradient-to-br from-red-950/40 to-zinc-900 border border-red-900/50 rounded-2xl p-5">
              <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Who You're Becoming</p>
              <p className="text-white text-base font-medium leading-relaxed">
                "{livingProfile.identity_statement}"
              </p>

              {/* Inline strengths */}
              {hasEvidenceItems(livingProfile.strengths) && (
                <div className="mt-3 pt-3 border-t border-red-900/30 space-y-1">
                  <p className="text-zinc-600 text-xs uppercase tracking-widest mb-1">Strengths</p>
                  {livingProfile.strengths.filter((s) => typeof s === 'object' && s.evidence).slice(0, 2).map((s, i) => {
                    const label = typeof s === 'object' ? s.label : s;
                    return (
                      <p key={i} className="text-zinc-400 text-xs leading-relaxed">
                        — <span className="text-zinc-300">{label}</span>: {s.evidence}
                      </p>
                    );
                  })}
                </div>
              )}

              {/* Inline growth areas */}
              {hasEvidenceItems(livingProfile.growth_areas) && (
                <div className="mt-3 pt-3 border-t border-red-900/30 space-y-1">
                  <p className="text-zinc-600 text-xs uppercase tracking-widest mb-1">Growing In</p>
                  {livingProfile.growth_areas.filter((g) => typeof g === 'object' && g.evidence).slice(0, 2).map((g, i) => {
                    const label = typeof g === 'object' ? g.label : g;
                    return (
                      <p key={i} className="text-zinc-400 text-xs leading-relaxed">
                        — <span className="text-zinc-300">{label}</span>: {g.evidence}
                      </p>
                    );
                  })}
                </div>
              )}

              {livingProfile.profile_updated_at && (
                <p className="text-zinc-600 text-xs mt-3">
                  Last updated{' '}
                  {new Date(livingProfile.profile_updated_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric',
                  })}
                </p>
              )}
            </div>
          )}

          {/* ── ZONE 3: Patterns ──────────────────────────────────────────── */}

          {/* Section 6: What We've Noticed */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">What We've Noticed</h2>
            {narratives.length > 0 ? (
              <div className="space-y-3">
                {narratives.map((n, i) => {
                  const borderColor =
                    n.type === 'blocker'  ? 'border-l-red-600' :
                    n.type === 'strength' ? 'border-l-green-600' :
                                            'border-l-zinc-500';
                  const label =
                    n.type === 'blocker'  ? 'Something we keep seeing' :
                    n.type === 'strength' ? 'A strength emerging' :
                                            'A pattern';
                  return (
                    <div
                      key={i}
                      className={`bg-zinc-900 border border-zinc-800 border-l-4 ${borderColor} rounded-2xl p-4`}
                    >
                      <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">{label}</p>
                      <p className="text-zinc-300 text-sm leading-relaxed">{n.narrative}</p>
                      {n.watch_for && (
                        <p className="text-zinc-500 text-xs mt-3 italic border-t border-zinc-800 pt-3">
                          Watch for: {n.watch_for}
                        </p>
                      )}
                      {n.occurrences && (
                        <p className="text-zinc-600 text-xs mt-2">
                          {n.occurrences} time{n.occurrences !== 1 ? 's' : ''} in your reflections
                        </p>
                      )}
                      {n.first_seen_date && (() => {
                        const first = formatInsightDate(n.first_seen_date);
                        const last  = n.last_seen_date ? formatInsightDate(n.last_seen_date) : null;

                        // Determine if span > 14 days
                        const spanDays = n.last_seen_date
                          ? Math.round(
                              (new Date(n.last_seen_date) - new Date(n.first_seen_date)) / (1000 * 60 * 60 * 24)
                            )
                          : 0;

                        const showRange = last && spanDays > 14;

                        return (
                          <p className="text-zinc-600 text-xs mt-1">
                            {showRange
                              ? `${first} → ${last}`
                              : `First noticed ${first}`}
                          </p>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Your coach is still learning your patterns. The more specific you are in your sessions, the faster these appear.
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
