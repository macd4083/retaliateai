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

// ─── Main Component ────────────────────────────────────��──────────────────────

export default function InsightsV2() {
  const { user } = useAuth();

  const [livingProfile, setLivingProfile]       = useState(null);
  const [allCommitments, setAllCommitments]       = useState([]);
  const [visibleCount, setVisibleCount]           = useState(7);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(null);
  const [wins, setWins]                           = useState([]);
  const [patterns, setPatterns]                   = useState([]);
  const [narratives, setNarratives]               = useState([]);
  const [streak, setStreak]                       = useState(0);
  const [commitmentStats, setCommitmentStats]     = useState(null);
  const [loading, setLoading]                     = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    loadData();
  }, [user?.id]);

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([
        loadProfile(),
        loadSessions(),
        loadPatterns(),
        loadStreak(),
        loadCommitmentStats(),
        loadNarratives(),
      ]);
    } finally {
      setLoading(false);
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

  async function loadSessions() {
    const today = localDateStr(0);

    // Fetch all sessions with a commitment (desc, up to 100)
    const { data: allWithCommitment } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
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
        return { date: s.date, commitment: s.tomorrow_commitment, status };
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

  async function loadPatterns() {
    const { data } = await supabase
      .from('reflection_patterns')
      .select('label, occurrence_count, pattern_type')
      .eq('user_id', user.id)
      .gte('occurrence_count', 2)
      .order('occurrence_count', { ascending: false })
      .limit(6);
    setPatterns(data || []);
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

  async function loadNarratives() {
    try {
      const res = await fetch('/api/generate-pattern-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setNarratives(data.narratives || []);
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

  const ft       = commitmentStats?.followThrough7;
  const ftPrior  = commitmentStats?.followThroughPrior7;
  const trajectory = commitmentStats?.trajectory;
  const { recoveryDays = 0, recoveriesCount = 0 } = commitmentStats || {};
  const weeklyData = commitmentStats?.weeklyData || [];

  // Selected week defaults to the most recent (last index)
  const activeWeekIndex      = selectedWeekIndex !== null ? selectedWeekIndex : Math.max(0, weeklyData.length - 1);
  const selectedWeek         = weeklyData[activeWeekIndex] ?? null;
  const isCurrentWeekSelected = weeklyData.length === 0 || activeWeekIndex === weeklyData.length - 1;

  const priorKept = ftPrior?.kept ?? 0;

  function trajectoryLine() {
    if (!ft || ft.total < 3) return 'Keep showing up — more data coming.';
    if (trajectory === 'improving')
      return `Up from ${priorKept} last week — you're building momentum.`;
    if (trajectory === 'declining')
      return `Down from ${priorKept} last week. Worth paying attention to.`;
    return 'Consistent with last week.';
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
        <div className="max-w-md mx-auto px-4 py-6 space-y-8">

          {/* ── Section 1: Consistency Tracker ────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-white font-semibold text-lg mb-4">Consistency Tracker</p>

            {weeklyData.length > 0 ? (() => {
              // ── Sparkline: Y-axis is 0–7 (kept count, not rate) ───────
              const MAX_KEPT = 7;
              const padX     = 20;
              const baseline = 70;
              const chartTop = 10;
              const chartH   = baseline - chartTop;
              const totalW   = 320;
              const n        = weeklyData.length;
              const xStep    = n > 1 ? (totalW - 2 * padX) / (n - 1) : 0;

              function getX(i) { return padX + i * xStep; }
              // Map kept (0–7) to Y coordinate; null = no data = baseline
              function getY(kept) {
                return kept === null ? baseline : baseline - (kept / MAX_KEPT) * chartH;
              }

              const lineParts = weeklyData.map((w, i) => {
                const x = getX(i).toFixed(1);
                const y = getY(w.kept > 0 || w.total > 0 ? w.kept : null).toFixed(1);
                return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
              });

              // ── Half-circle gauge: kept / 7 (hard max) ────────────────
              const cx       = 100;
              const cy       = 108;
              const r        = 78;
              const halfCirc = Math.PI * r;
              const fullCirc = 2 * Math.PI * r;

              // This week's kept (integer 0–7)
              const gKept    = selectedWeek?.kept ?? 0;
              // Total is always 7; we use it only for display text
              const hasData  = selectedWeek !== null && selectedWeek.total > 0;
              const fillFrac = hasData ? Math.min(gKept / MAX_KEPT, 1) : 0;
              const fillLen  = fillFrac * halfCirc;
              const fillColor = !hasData ? '#52525b' : gKept >= 5 ? '#dc2626' : gKept >= 3 ? '#f97316' : '#71717a';

              const weekDescText = !hasData
                ? 'No commitments tracked this week.'
                : gKept >= 6
                  ? `Strong week — ${gKept}/7 commitments followed through.`
                  : gKept >= 4
                    ? `Solid week — ${gKept}/7 commitments followed through.`
                    : gKept >= 2
                      ? `${gKept}/7 commitments followed through this week.`
                      : `Tough week — ${gKept}/7 commitments this week.`;

              return (
                <>
                  {/* Sparkline SVG */}
                  <svg viewBox="0 0 320 100" className="w-full mb-1">
                    {/* Y-axis labels: 7, 3, 0 */}
                    <text x={padX - 4} y={chartTop + 4} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="sans-serif">7</text>
                    <text x={padX - 4} y={(chartTop + baseline) / 2 + 3} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="sans-serif">3</text>
                    <text x={padX - 4} y={baseline} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="sans-serif">0</text>
                    {/* Dashed baseline */}
                    <line x1={padX} y1={baseline} x2={totalW - padX} y2={baseline}
                      stroke="#3f3f46" strokeWidth={1} strokeDasharray="3 3" />
                    {/* Mid-line at 3/7 */}
                    <line x1={padX} y1={getY(3)} x2={totalW - padX} y2={getY(3)}
                      stroke="#27272a" strokeWidth={1} strokeDasharray="2 4" />
                    {/* Connecting line */}
                    <path d={lineParts.join(' ')} fill="none" stroke="#52525b" strokeWidth={1.5} />
                    {/* Dots, tooltips, week labels */}
                    {weeklyData.map((w, i) => {
                      const hasWkData  = w.kept > 0 || w.total > 0;
                      const keptVal    = hasWkData ? w.kept : null;
                      const x          = getX(i);
                      const y          = getY(keptVal);
                      const isSelected = i === activeWeekIndex;
                      return (
                        <g key={i} onClick={() => setSelectedWeekIndex(i)} style={{ cursor: 'pointer' }}>
                          {isSelected && hasWkData && (
                            <>
                              <rect x={x - 14} y={y - 22} width={28} height={16} rx={7}
                                fill="#27272a" stroke="#3f3f46" strokeWidth={1} />
                              <text x={x} y={y - 10} textAnchor="middle"
                                fill="white" fontSize={9} fontWeight="bold" fontFamily="sans-serif">
                                {w.kept}/7
                              </text>
                            </>
                          )}
                          <circle
                            cx={x} cy={y} r={isSelected ? 5.5 : 4}
                            fill={isSelected ? '#ef4444' : hasWkData ? '#71717a' : '#27272a'}
                          />
                          <text x={x} y={95} textAnchor="middle"
                            fill={isSelected ? '#ef4444' : '#52525b'} fontSize={8} fontFamily="sans-serif">
                            {w.weekLabel}
                          </text>
                        </g>
                      );
                    })}
                  </svg>

                  {/* Half-circle gauge + commitment list side by side */}
                  <div className="flex gap-4 items-start mt-2">
                    {/* Gauge */}
                    <div className="flex-shrink-0">
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
                          transform={`rotate(180 ${cx} ${cy})`}
                        />
                        {/* Centre label */}
                        <text x={cx} y={cy - 14} textAnchor="middle"
                          fill="white" fontSize={26} fontWeight="bold" fontFamily="sans-serif">
                          {gKept}
                        </text>
                        <text x={cx} y={cy + 6} textAnchor="middle"
                          fill="#71717a" fontSize={11} fontFamily="sans-serif">
                          of 7
                        </text>
                        <text x={cx} y={cy + 22} textAnchor="middle"
                          fill="#52525b" fontSize={9} fontFamily="sans-serif">
                          this week
                        </text>
                      </svg>
                    </div>

                    {/* Commitment list for selected week */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {displayedCommitments.length === 0 ? (
                        <p className="text-zinc-500 text-sm">
                          {isCurrentWeekSelected
                            ? 'No commitments yet. Start a reflection tonight.'
                            : 'No commitments this week.'}
                        </p>
                      ) : (
                        displayedCommitments.map((c, i) => (
                          <div
                            key={i}
                            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5"
                          >
                            <div className="flex items-start gap-2">
                              <span className="flex-shrink-0 mt-0.5">
                                {c.status === 'kept'    ? '✅' :
                                 c.status === 'missed'  ? '❌' : '⏳'}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-zinc-200 text-sm leading-snug">{c.commitment}</p>
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

                      {/* Load more — only for current week when there's more */}
                      {showLoadMore && (
                        <button
                          onClick={() => setVisibleCount((c) => c + 7)}
                          className="mt-1 text-zinc-400 text-sm flex items-center gap-1 hover:text-white transition-colors"
                        >
                          Show more <ChevronDown size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Trajectory line */}
                  {ft && ft.total >= 3 && (
                    <p className="text-zinc-500 text-xs mt-3">{trajectoryLine()}</p>
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

          {/* ── Section 2: Streak ─────────────────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-white font-semibold text-lg">{streak} night streak</p>
              <p className="text-zinc-500 text-sm">Keep showing up.</p>
            </div>
          </div>

          {/* ── Section 3: Who You're Becoming ────────────────────────── */}
          {livingProfile?.identity_statement && (
            <div className="bg-gradient-to-br from-red-950/40 to-zinc-900 border border-red-900/50 rounded-2xl p-5">
              <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Who You're Becoming</p>
              <p className="text-white text-base font-medium leading-relaxed">
                "{livingProfile.identity_statement}"
              </p>
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

          {/* ── Section 4: Bounce Back ────────────────────────────────── */}
          {recoveriesCount > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <p className="text-white font-semibold text-base mb-1">Bounce Back</p>
              <p className="text-zinc-500 text-xs mb-3">
                Missing isn't failing. Coming back is the skill.
              </p>
              <p className="text-zinc-300 text-sm">
                You've bounced back {recoveriesCount} time{recoveriesCount !== 1 ? 's' : ''} this month.
              </p>
              <p className="text-zinc-400 text-sm mt-1">
                {recoveryDays <= 1
                  ? 'And you never missed more than a day.'
                  : `Your longest gap was ${recoveryDays} day${recoveryDays !== 1 ? 's' : ''} — and you came back.`}
              </p>
            </div>
          )}

          {/* ── Section 5: Right Now ──────────────────────────────────── */}
          {livingProfile?.short_term_state && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Right Now</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <p className="text-zinc-300 text-sm leading-relaxed">
                  {livingProfile.short_term_state}
                </p>
              </div>
            </section>
          )}

          {/* ── Section 6: What We've Noticed (AI narrative cards) ───── */}
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
                    </div>
                  );
                })}
              </div>
            ) : patterns.length > 0 ? (
              /* Fallback to raw pattern counts if narratives haven't loaded yet */
              <div className="space-y-3">
                {patterns.map((p, i) => (
                  <div
                    key={i}
                    className={`bg-zinc-900 border border-zinc-800 border-l-4 ${
                      p.pattern_type === 'blocker' ? 'border-l-red-600' :
                      p.pattern_type === 'strength' ? 'border-l-green-600' :
                      'border-l-zinc-500'
                    } rounded-2xl p-4`}
                  >
                    <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
                      {p.pattern_type === 'blocker'  ? 'Something we keep seeing' :
                       p.pattern_type === 'strength' ? 'A strength emerging' : 'A pattern'}
                    </p>
                    <p className="text-zinc-300 text-sm leading-relaxed">
                      <strong className="text-white">{p.label}</strong> — {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''} in your reflections.
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Patterns emerge after 3–5 reflections. The more specific you are in your sessions, the faster we can surface what's really going on.
              </p>
            )}
          </section>

          {/* ── Section 7: Growing In ─────────────────────────────────── */}
          {livingProfile?.growth_areas && livingProfile.growth_areas.length > 0 && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Growing In</h2>
              <div className="space-y-2">
                {livingProfile.growth_areas.map((area, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-red-500 text-sm">↑</span>
                    <p className="text-zinc-200 text-sm">{area}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Section 8: Your Strengths ─────────────────────────────── */}
          {livingProfile?.strengths && livingProfile.strengths.length > 0 && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Your Strengths 💪</h2>
              <div className="space-y-2">
                {livingProfile.strengths.map((s, i) => (
                  <div key={i} className="bg-zinc-900 border border-green-900/40 rounded-xl px-4 py-3">
                    <p className="text-zinc-200 text-sm">
                      <strong className="text-white">{s}</strong> shows up consistently in how you work.
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Section 9: Your Values ────────────────────────────────── */}
          {livingProfile?.values && livingProfile.values.length > 0 && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Your Values</h2>
              <div className="flex flex-wrap gap-2">
                {livingProfile.values.map((v, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Section 10: Recent Wins ───────���───────────────────────── */}
          {wins.length > 0 && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Recent Wins</h2>
              <div className="space-y-2">
                {wins.map((w, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-start gap-3">
                    <span className="text-green-400 text-sm mt-0.5">✅</span>
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-sm">{w.text}</p>
                      <p className="text-zinc-500 text-xs mt-0.5">{formatDate(w.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Section 11: Long-Term Patterns ───────────────────────── */}
          {livingProfile?.long_term_patterns && livingProfile.long_term_patterns.length > 0 && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Long-Term Patterns</h2>
              <div className="space-y-2">
                {livingProfile.long_term_patterns.map((p, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-start gap-3">
                    <span className="text-zinc-500 text-sm mt-0.5">→</span>
                    <p className="text-zinc-300 text-sm">{p}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Bottom padding */}
          <div className="h-6" />

        </div>
      </div>
    </AppShellV2>
  );
}