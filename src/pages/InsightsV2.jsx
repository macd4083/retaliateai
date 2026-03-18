import React, { useEffect, useState } from 'react';
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

export default function InsightsV2() {
  const { user } = useAuth();

  const [livingProfile, setLivingProfile] = useState(null);
  const [commitmentSessions, setCommitmentSessions] = useState([]); // sessions with follow-through status
  const [recentCommitments, setRecentCommitments] = useState([]);   // last 10 for the list
  const [wins, setWins] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [streak, setStreak] = useState(0);
  const [commitmentStats, setCommitmentStats] = useState(null);
  const [loading, setLoading] = useState(true);

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
    // Fetch last 14 days of sessions (with commitment and completion info) for circle visualization
    const { data: sessions14 } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user.id)
      .gte('date', localDateStr(-14))
      .lte('date', localDateStr(0))
      .order('date', { ascending: true });

    const allSessions = sessions14 || [];
    const sessionsByDate = {};
    for (const s of allSessions) {
      sessionsByDate[s.date] = s;
    }

    // Compute follow-through status for each session with a commitment
    const withCommitment = allSessions.filter((s) => !!s.tomorrow_commitment);
    const mostRecentDate = withCommitment.length > 0 ? withCommitment[withCommitment.length - 1].date : null;

    // Take last 7 sessions with commitments for the circle display
    const circles = withCommitment.slice(-7).map((s) => {
      const nextDay = addDays(s.date, 1);
      const isPending = s.date === mostRecentDate;
      return {
        date: s.date,
        commitment: s.tomorrow_commitment,
        status: isPending ? 'pending' : (sessionsByDate[nextDay]?.is_complete ? 'kept' : 'missed'),
      };
    });
    setCommitmentSessions(circles);

    // Recent 10 commitments for the list section
    const { data: recentC } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, is_complete')
      .eq('user_id', user.id)
      .not('tomorrow_commitment', 'is', null)
      .order('date', { ascending: false })
      .limit(10);

    // For each recent commitment, check next-day completion client-side
    // We need session data for the day after each commitment
    if (recentC && recentC.length > 0) {
      const oldestDate = recentC[recentC.length - 1].date;
      const newestNextDay = addDays(recentC[0].date, 1);

      const { data: checkSessions } = await supabase
        .from('reflection_sessions')
        .select('date, is_complete')
        .eq('user_id', user.id)
        .gte('date', oldestDate)
        .lte('date', newestNextDay)
        .order('date', { ascending: true });

      const checkMap = {};
      for (const s of checkSessions || []) {
        checkMap[s.date] = s;
      }

      const mostRecentCommitmentDate = recentC[0].date;
      const enriched = recentC.map((c) => {
        const nextDay = addDays(c.date, 1);
        const isPending = c.date === mostRecentCommitmentDate;
        return {
          ...c,
          status: isPending ? 'pending' : (checkMap[nextDay]?.is_complete ? 'kept' : 'missed'),
        };
      });
      setRecentCommitments(enriched);
    } else {
      setRecentCommitments([]);
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
      .order('occurrence_count', { ascending: false });
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

  // ── Derived values ──────────────────────────────────────────────────────────

  const ft = commitmentStats?.followThrough7;
  const ftPrior = commitmentStats?.followThroughPrior7;
  const trajectory = commitmentStats?.trajectory;
  const { recoveryDays = 0, recoveriesCount = 0 } = commitmentStats || {};

  const priorRate = ftPrior?.total > 0 ? Math.round((ftPrior.kept / ftPrior.total) * 100) : null;

  function trajectoryLine() {
    if (!ft || ft.total < 3) return 'Keep showing up — more data coming.';
    if (trajectory === 'improving' && priorRate !== null)
      return `Up from ${priorRate}% last week. You're building real consistency.`;
    if (trajectory === 'declining' && priorRate !== null)
      return `Down from ${priorRate}% last week. That's worth paying attention to.`;
    return 'Consistent with last week.';
  }

  // Reflection patterns for narrative cards
  const patternCards = patterns.filter((p) => p.occurrence_count >= 2);
  const longTermPatterns = Array.isArray(livingProfile?.long_term_patterns) ? livingProfile.long_term_patterns : [];

  return (
    <AppShellV2 title="Insights">
      <div className="h-full overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-6 space-y-8">

          {/* ── Section 1: Follow-Through Card ────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-500 text-xs uppercase tracking-widest mb-0.5">Follow-Through</p>
            <p className="text-zinc-600 text-xs mb-3">Did you do what you said you'd do?</p>
            {ft && ft.total > 0 ? (
              <>
                <p className="text-white text-3xl font-bold mb-4">
                  {ft.kept} <span className="text-zinc-500 text-xl font-normal">of {ft.total}</span>
                </p>
                {/* Circle visual */}
                <div className="flex gap-2 mb-3">
                  {commitmentSessions.map((s, i) => (
                    <div
                      key={i}
                      title={`${formatDate(s.date)}: ${s.status}`}
                      className={`w-6 h-6 rounded-full border-2 flex-shrink-0 ${
                        s.status === 'kept'
                          ? 'bg-green-500 border-green-500'
                          : s.status === 'pending'
                          ? 'bg-zinc-700 border-zinc-500'
                          : 'bg-zinc-800 border-zinc-700'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-zinc-400 text-sm">{trajectoryLine()}</p>
              </>
            ) : (
              <p className="text-zinc-500 text-sm">Keep showing up — more data coming.</p>
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
              <p className="text-white text-base font-medium leading-relaxed">"{livingProfile.identity_statement}"</p>
              {livingProfile.profile_updated_at && (
                <p className="text-zinc-600 text-xs mt-3">
                  Last updated {new Date(livingProfile.profile_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              )}
            </div>
          )}

          {/* ── Section 4: Recovery Speed (only if recoveriesCount > 0) ─ */}
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
                      <div key={i} className="bg-zinc-900 border border-red-900/50 rounded-2xl p-4">
                        <p className="text-zinc-500 text-xs mb-2">Something we've noticed</p>
                        <p className="text-zinc-200 text-sm leading-relaxed">
                          You've brought up <strong className="text-white">{p.label}</strong> {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''}.
                          That's not a character flaw — it's a pattern worth understanding. What's underneath it?
                        </p>
                      </div>
                    );
                  }
                  if (p.pattern_type === 'strength') {
                    return (
                      <div key={i} className="bg-zinc-900 border border-green-900/50 rounded-2xl p-4">
                        <p className="text-zinc-500 text-xs mb-2">A strength emerging</p>
                        <p className="text-zinc-200 text-sm leading-relaxed">
                          <strong className="text-white">{p.label}</strong> has shown up {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''} in your
                          reflections. That's not a coincidence.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4">
                      <p className="text-zinc-500 text-xs mb-2">A thread we keep seeing</p>
                      <p className="text-zinc-200 text-sm leading-relaxed">
                        <strong className="text-white">{p.label}</strong> keeps coming up — {p.occurrence_count} time{p.occurrence_count !== 1 ? 's' : ''} now.
                        Worth sitting with.
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : longTermPatterns.length > 0 ? (
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4">
                <p className="text-zinc-500 text-xs mb-2">Recurring themes</p>
                <p className="text-zinc-200 text-sm leading-relaxed">
                  We've noticed{' '}
                  {longTermPatterns.slice(0, 2).map((p, i, arr) => (
                    <React.Fragment key={i}>
                      <strong className="text-white">{p}</strong>
                      {i < arr.length - 1 ? ' and ' : ''}
                    </React.Fragment>
                  ))}{' '}
                  as recurring themes in your reflections.
                </p>
              </div>
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Patterns emerge after a few reflections. Keep showing up.
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

          {/* ── Section 8: Your Strengths (small cards) ──────────────── */}
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

          {/* ── Section 9: Your Values (chips — identity anchors) ─────── */}
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

          {/* ── Section 10: Recent Commitments (fixed follow-through) ─── */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Recent Commitments</h2>
            {recentCommitments.length === 0 ? (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                No commitments yet. Start a reflection tonight.
              </p>
            ) : (
              <div className="space-y-2">
                {recentCommitments.map((c, i) => {
                  const icon = c.status === 'kept' ? '✅' : c.status === 'pending' ? '⏳' : '⬜';
                  const iconColor = c.status === 'kept' ? 'text-green-400' : c.status === 'pending' ? 'text-yellow-500' : 'text-zinc-600';
                  return (
                    <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start gap-3">
                      <span className={`text-lg flex-shrink-0 mt-0.5 ${iconColor}`}>{icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-500 text-xs mb-1">{formatDate(c.date)}</p>
                        <p className="text-zinc-200 text-sm leading-relaxed">{c.tomorrow_commitment}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Section 11: Recent Wins ───────────────────────────────── */}
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
