import React, { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';

// Add n days to a YYYY-MM-DD string
function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Return the Monday of the ISO week containing dateStr (Mon = week start)
function getMondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(y, m - 1, d - offset);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

export default function InsightsV2() {
  const { user } = useAuth();

  const [livingProfile, setLivingProfile] = useState(null);
  const [allCommitments, setAllCommitments] = useState([]);
  const [visibleCount, setVisibleCount] = useState(7);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(null);
  const [wins, setWins] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [streak, setStreak] = useState(0);
  const [commitmentStats, setCommitmentStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedCommitments, setExpandedCommitments] = useState(new Set());

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

    // Fetch all sessions with a commitment (desc order, up to 100)
    const { data: allWithCommitment } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user.id)
      .not('tomorrow_commitment', 'is', null)
      .order('date', { ascending: false })
      .limit(100);

    // Day-behind rule: include a session as a commitment row only if
    // is_complete === true OR the date is before today (already passed).
    const eligibleCommitments = (allWithCommitment || []).filter(
      (s) => s.is_complete || s.date < today
    );

    if (eligibleCommitments.length > 0) {
      const newestDate = eligibleCommitments[0].date;
      const oldestDate = eligibleCommitments[eligibleCommitments.length - 1].date;

      // Fetch sessions in the date range for next-day lookups
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
        // Most recent: pending unless next day already has a completed session
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
      const winsArr = session.wins;
      if (Array.isArray(winsArr)) {
        for (const win of winsArr) {
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
      .limit(4);
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

  const ft = commitmentStats?.followThrough7;
  const ftPrior = commitmentStats?.followThroughPrior7;
  const trajectory = commitmentStats?.trajectory;
  const { recoveryDays = 0, recoveriesCount = 0 } = commitmentStats || {};
  const weeklyData = commitmentStats?.weeklyData || [];

  // Selected week: defaults to the most recent week (last index)
  const activeWeekIndex = selectedWeekIndex !== null ? selectedWeekIndex : Math.max(0, weeklyData.length - 1);
  const selectedWeek = weeklyData[activeWeekIndex] ?? null;
  const isCurrentWeekSelected = weeklyData.length === 0 || activeWeekIndex === weeklyData.length - 1;

  const priorRate = ftPrior?.total > 0 ? Math.round((ftPrior.kept / ftPrior.total) * 100) : null;

  function trajectoryLine() {
    if (!ft || ft.total < 3) return 'Keep showing up — more data coming.';
    if (trajectory === 'improving' && priorRate !== null)
      return `Up from ${priorRate}% last week — you're building momentum.`;
    if (trajectory === 'declining' && priorRate !== null)
      return `Down from ${priorRate}% last week. Worth paying attention to.`;
    return 'Consistent with last week.';
  }

  // Commitment list: filter to selected week for non-current weeks
  const displayedCommitments = (() => {
    if (isCurrentWeekSelected) {
      return allCommitments.slice(0, visibleCount);
    }
    const weeksBack = weeklyData.length - 1 - activeWeekIndex;
    const todayStr = localDateStr(0);
    const todayMonday = getMondayOf(todayStr);
    const wStart = addDays(todayMonday, -weeksBack * 7);
    const wEnd = addDays(wStart, 6);
    return allCommitments.filter((c) => c.date >= wStart && c.date <= wEnd);
  })();
  const showLoadMore = isCurrentWeekSelected && allCommitments.length > visibleCount;

  function toggleCommitmentExpanded(key) {
    setExpandedCommitments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Reflection patterns for narrative cards
  const patternCards = patterns.filter((p) => p.occurrence_count >= 2);
  const longTermPatterns = Array.isArray(livingProfile?.long_term_patterns) ? livingProfile.long_term_patterns : [];

  return (
    <AppShellV2 title="Insights">
      <div className="h-full overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-6 space-y-8">

          {/* ── Section 1: Consistency Tracker ────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-white font-semibold text-lg mb-4">Consistency Tracker</p>

            {weeklyData.length > 0 ? (() => {
              // ── Sparkline ──────────────────────────────────────────────
              const padX = 20;
              const baseline = 70;
              const chartTop = 25;
              const chartH = baseline - chartTop;
              const totalW = 320;
              const n = weeklyData.length;
              const xStep = n > 1 ? (totalW - 2 * padX) / (n - 1) : 0;

              function getX(i) { return padX + i * xStep; }
              function getY(rate) { return rate === null ? baseline : baseline - rate * chartH; }

              const lineParts = weeklyData.map((w, i) => {
                const x = getX(i).toFixed(1);
                const y = getY(w.rate).toFixed(1);
                return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
              });

              // ── Gauge ──────────────────────────────────────────────────
              const cx = 100, cy = 108, r = 78;
              const halfCirc = Math.PI * r;
              const fullCirc = 2 * Math.PI * r;
              const gRate = selectedWeek?.rate ?? null;
              const gKept = selectedWeek?.kept ?? 0;
              const gTotal = selectedWeek?.total ?? 0;
              const fillLen = gRate !== null ? Math.min(gRate * halfCirc, halfCirc) : 0;
              const fillColor = gRate === null ? '#52525b' : gRate >= 0.6 ? '#dc2626' : '#71717a';

              const weekDescText = gRate === null
                ? 'No commitments tracked this week.'
                : gRate >= 0.8
                  ? `Strong week — ${gKept} of ${gTotal} commitments followed through.`
                  : gRate >= 0.6
                    ? `Solid week — ${gKept} of ${gTotal} commitments followed through.`
                    : gRate >= 0.3
                      ? `${gKept} of ${gTotal} commitments followed through this week.`
                      : `Tough week — ${gKept} of ${gTotal} commitments this week.`;

              return (
                <>
                  {/* Sparkline SVG */}
                  <svg viewBox="0 0 320 100" className="w-full mb-1">
                    {/* Dashed baseline */}
                    <line x1={padX} y1={baseline} x2={totalW - padX} y2={baseline}
                      stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
                    {/* Connecting line */}
                    <path d={lineParts.join(' ')} fill="none" stroke="#52525b" strokeWidth={1.5} />
                    {/* Dots, tooltips, week labels */}
                    {weeklyData.map((w, i) => {
                      const x = getX(i);
                      const y = getY(w.rate);
                      const isSelected = i === activeWeekIndex;
                      const hasData = w.total > 0;
                      return (
                        <g key={i} onClick={() => setSelectedWeekIndex(i)} style={{ cursor: 'pointer' }}>
                          {isSelected && hasData && (
                            <>
                              <rect x={x - 16} y={y - 23} width={32} height={17} rx={8}
                                fill="#27272a" stroke="#3f3f46" strokeWidth={1} />
                              <text x={x} y={y - 10} textAnchor="middle"
                                fill="white" fontSize={9} fontWeight="bold" fontFamily="sans-serif">
                                {w.kept}/{w.total}
                              </text>
                            </>
                          )}
                          <circle cx={x} cy={y} r={isSelected ? 5.5 : 4}
                            fill={isSelected ? '#ef4444' : hasData ? '#71717a' : '#27272a'} />
                          <text x={x} y={95} textAnchor="middle"
                            fill={isSelected ? '#a1a1aa' : '#52525b'} fontSize={8} fontFamily="sans-serif">
                            {w.weekLabel}
                          </text>
                        </g>
                      );
                    })}
                  </svg>

                  {/* Half-donut gauge */}
                  <div className="mt-1">
                    <svg viewBox="0 0 200 115" className="w-full max-w-[220px] mx-auto block">
                      {/* Background arc */}
                      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#3f3f46"
                        strokeWidth={13}
                        strokeDasharray={`${halfCirc.toFixed(1)} ${fullCirc.toFixed(1)}`}
                        strokeLinecap="round"
                        transform={`rotate(-180, ${cx}, ${cy})`} />
                      {/* Fill arc */}
                      {fillLen > 0 && (
                        <circle cx={cx} cy={cy} r={r} fill="none" stroke={fillColor}
                          strokeWidth={13}
                          strokeDasharray={`${fillLen.toFixed(1)} ${fullCirc.toFixed(1)}`}
                          strokeLinecap="round"
                          transform={`rotate(-180, ${cx}, ${cy})`} />
                      )}
                      {/* Center fraction */}
                      <text x={cx} y={cy - 8} textAnchor="middle"
                        fill="white" fontSize={30} fontWeight="bold" fontFamily="sans-serif">
                        {gRate !== null ? `${gKept}/${gTotal}` : '—'}
                      </text>
                    </svg>
                    {/* Trajectory indicator — only for the current week */}
                    {isCurrentWeekSelected && ft && ft.total >= 3 && (
                      <p className="text-center text-zinc-400 text-xs mt-1">
                        {trajectory === 'improving' ? '▲ Getting better'
                          : trajectory === 'declining' ? '▼ Slipping'
                          : '→ Holding steady'}
                      </p>
                    )}
                    {/* Plain-language week description */}
                    <p className="text-center text-zinc-500 text-sm mt-2">{weekDescText}</p>
                  </div>
                </>
              );
            })() : (
              /* Fallback: no weekly data yet */
              <div className="space-y-4 mb-4">
                {ft && ft.total > 0 ? (
                  <>
                    <p className="text-white text-3xl font-bold">
                      {ft.kept} <span className="text-zinc-500 text-xl font-normal">of {ft.total}</span>
                    </p>
                    <p className="text-zinc-400 text-sm">{trajectoryLine()}</p>
                  </>
                ) : (
                  <p className="text-zinc-500 text-sm">Keep showing up — more data coming.</p>
                )}
              </div>
            )}

            {/* Commitment list */}
            <div className="border-t border-zinc-800 mt-4 pt-4">
              {displayedCommitments.length > 0 ? (
                <div className="space-y-2">
                  {displayedCommitments.map((c, i) => {
                    const key = c.date || `idx-${i}`;
                    const isExpanded = expandedCommitments.has(key);
                    return (
                      <div key={key} className="bg-zinc-800 rounded-xl border border-zinc-700 overflow-hidden">
                        <button
                          onClick={() => toggleCommitmentExpanded(key)}
                          className="w-full px-4 py-3 flex items-center gap-3 text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-zinc-500 text-xs mb-0.5">{formatDate(c.date)}</p>
                            <p className="text-zinc-200 text-sm leading-relaxed line-clamp-1">{c.commitment}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {c.status === 'kept' && (
                              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                                <Check size={12} className="text-white" />
                              </div>
                            )}
                            {c.status === 'pending' && (
                              <div className="w-6 h-6 rounded-full border-2 border-zinc-600" />
                            )}
                            {c.status === 'missed' && (
                              <div className="w-6 h-6 rounded-full border-2 border-red-900" />
                            )}
                            <ChevronDown
                              size={14}
                              className={`text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-zinc-700">
                            <p className="text-zinc-300 text-sm leading-relaxed mt-3">{c.commitment}</p>
                            <p className={`text-xs mt-2 font-medium ${
                              c.status === 'kept' ? 'text-green-400' :
                              c.status === 'missed' ? 'text-red-400' :
                              'text-zinc-500'
                            }`}>
                              {c.status === 'kept' ? '✅ Followed through' :
                               c.status === 'missed' ? '❌ Missed' :
                               '⏳ Pending — check back tomorrow'}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">
                  {isCurrentWeekSelected ? 'No commitments yet. Start a reflection tonight.' : 'No commitments this week.'}
                </p>
              )}

              {/* Show more — only for current week when there's more data */}
              {showLoadMore && (
                <button
                  onClick={() => setVisibleCount((c) => c + 7)}
                  className="mt-3 text-zinc-400 text-sm flex items-center gap-1 hover:text-white transition-colors"
                >
                  Show more commitments
                  <ChevronDown size={14} />
                </button>
              )}
            </div>
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
              <p className="text-white text-base font-medium leading-relaxed">"{livingProfile.identity_statement}"</p>
              {livingProfile.profile_updated_at && (
                <p className="text-zinc-600 text-xs mt-3">
                  Last updated {new Date(livingProfile.profile_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              )}
            </div>
          )}

          {/* ── Section 4: Bounce Back (only if recoveriesCount > 0) ──── */}
          {recoveriesCount > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <p className="text-white font-semibold text-base mb-1">Bounce Back</p>
              <p className="text-zinc-500 text-xs mb-3">Missing isn't failing. Coming back is the skill.</p>
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
                <p className="text-zinc-300 text-sm leading-relaxed">{livingProfile.short_term_state}</p>
              </div>
            </section>
          )}

          {/* ── Section 6: What We've Noticed (narrative cards) ───────── */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">What We've Noticed</h2>
            {patternCards.length > 0 ? (
              <div className="space-y-3">
                {patternCards.map((p, i) => {
                  if (p.pattern_type === 'blocker') {
                    return (
                      <div key={i} className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-red-600 rounded-2xl p-4">
                        <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Something we keep seeing</p>
                        <p className="text-zinc-300 text-sm leading-relaxed">
                          <strong className="text-white font-semibold">{p.label}</strong>{' '}
                          has come up {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''} in your reflections. That's not random — it's a signal. Worth sitting with.
                          {p.occurrence_count >= 8 && " At this point, it's not a one-off. It's a recurring chapter in your story."}
                          {p.occurrence_count >= 5 && p.occurrence_count < 8 && ' The fact that you keep naming it means part of you already knows it matters.'}
                        </p>
                      </div>
                    );
                  }
                  if (p.pattern_type === 'strength') {
                    return (
                      <div key={i} className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-green-600 rounded-2xl p-4">
                        <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">A strength we've noticed</p>
                        <p className="text-zinc-300 text-sm leading-relaxed">
                          <strong className="text-white font-semibold">{p.label}</strong>{' '}
                          has shown up {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''}. That's not luck — that's a pattern you've built.
                          {p.occurrence_count >= 5 && ' A month ago, this might not have even been on your radar.'}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-zinc-500 rounded-2xl p-4">
                      <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">A recurring thread</p>
                      <p className="text-zinc-300 text-sm leading-relaxed">
                        <strong className="text-white font-semibold">{p.label}</strong>{' '}
                        keeps coming back — {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''} now. Patterns like this are worth paying attention to.
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : longTermPatterns.length > 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 border-l-4 border-l-zinc-500 rounded-2xl p-4">
                <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">A recurring thread</p>
                <p className="text-zinc-300 text-sm leading-relaxed">
                  <strong className="text-white font-semibold">{longTermPatterns[0]}</strong>{' '}
                  keeps coming back. Patterns like this are worth paying attention to.
                </p>
              </div>
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Patterns emerge from repetition. Keep showing up and we'll start seeing yours.
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
                  <div key={i} className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-full text-zinc-300 text-xs">
                    {v}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Section 10: Recent Wins ───────────────────────────────── */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Recent Wins 🔥</h2>
            {wins.length === 0 ? (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Your wins will appear here after your first reflection.
              </p>
            ) : (
              <div className="space-y-2">
                {wins.map((win, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start gap-3">
                    <span className="text-green-400 flex-shrink-0 mt-0.5">✅</span>
                    <div>
                      <p className="text-zinc-200 text-sm leading-relaxed">{win.text}</p>
                      <p className="text-zinc-600 text-xs mt-1">{formatDate(win.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
    </AppShellV2>
  );
}