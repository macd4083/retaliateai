import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';

const LIFE_AREA_EMOJI = {
  'Career & Business': '💼',
  'Health & Fitness': '🏋️',
  'Relationships': '❤️',
  'Personal Growth': '🧠',
  'Money & Finance': '💰',
  'Creativity': '🎨',
  'Spirituality': '🙏',
  'Education': '🎓',
};

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function InsightsV2() {
  const { user } = useAuth();

  const [lifeAreas, setLifeAreas] = useState(null);
  const [livingProfile, setLivingProfile] = useState(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [commitments, setCommitments] = useState([]);
  const [wins, setWins] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [streak, setStreak] = useState(0);
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
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile() {
    const { data } = await supabase
      .from('user_profiles')
      .select('life_areas, short_term_state, strengths, values, identity_statement, growth_areas, long_term_patterns, profile_updated_at')
      .eq('id', user.id)
      .maybeSingle();
    setLifeAreas(data?.life_areas || []);
    setLivingProfile(data);
  }

  async function loadSessions() {
    // Completed sessions in last 30 days
    const { data: completed } = await supabase
      .from('reflection_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_complete', true)
      .gte('date', localDateStr(-30));
    setCompletedCount(completed?.length || 0);

    // Recent commitments
    const { data: sessions } = await supabase
      .from('reflection_sessions')
      .select('date, tomorrow_commitment, wins')
      .eq('user_id', user.id)
      .not('tomorrow_commitment', 'is', null)
      .order('date', { ascending: false })
      .limit(10);

    setCommitments(sessions || []);

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

  if (loading) {
    return (
      <AppShellV2 title="Insights">
        <div className="h-full overflow-y-auto flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
        </div>
      </AppShellV2>
    );
  }

  return (
    <AppShellV2 title="Insights">
      <div className="h-full overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-6 space-y-8">

          {/* ── Streak ──────────────────────────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-white font-semibold text-lg">{streak} night streak</p>
              <p className="text-zinc-500 text-sm">Keep showing up.</p>
            </div>
          </div>

          {/* ── Who You're Becoming ─────────────────────────────────────────── */}
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

          {/* ── Right Now ───────────────────────────────────────────────── */}
          {livingProfile?.short_term_state && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Right Now</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <p className="text-zinc-300 text-sm leading-relaxed">{livingProfile.short_term_state}</p>
              </div>
            </section>
          )}

          {/* ── Your Strengths ──────────────────────────────────────────── */}
          {livingProfile?.strengths && livingProfile.strengths.length > 0 && (
            <section>
              <h2 className="text-white font-semibold text-base mb-3">Your Strengths 💪</h2>
              <div className="flex flex-wrap gap-2">
                {livingProfile.strengths.map((s, i) => (
                  <div key={i} className="px-3 py-1.5 bg-green-950/60 border border-green-800/50 rounded-full text-green-300 text-xs">
                    {s}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Your Values ─────────────────────────────────────────────── */}
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

          {/* ── Growth Areas ────────────────────────────────────────────── */}
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

          {/* ── Life Areas ──────────────────────────────────────────── */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Your Focus Areas</h2>
            {!lifeAreas || lifeAreas.length === 0 ? (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Complete onboarding to see your focus areas.
              </p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                {lifeAreas.map((area) => (
                  <div
                    key={area}
                    className="flex-shrink-0 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col items-center gap-2 w-28"
                  >
                    <span className="text-2xl">{LIFE_AREA_EMOJI[area] || '✨'}</span>
                    <p className="text-zinc-300 text-xs text-center leading-tight">{area}</p>
                    <p className="text-zinc-500 text-xs">{completedCount} reflections</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Recent Commitments ──────────────────────────────────── */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Recent Commitments</h2>
            {commitments.length === 0 ? (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                No commitments yet. Start a reflection tonight.
              </p>
            ) : (
              <div className="space-y-2">
                {commitments.map((c, i) => {
                  const hasWins = Array.isArray(c.wins) && c.wins.length > 0;
                  return (
                    <div
                      key={i}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start gap-3"
                    >
                      <span className={`text-lg flex-shrink-0 mt-0.5 ${hasWins ? 'text-green-400' : 'text-zinc-600'}`}>
                        {hasWins ? '✅' : '⬜'}
                      </span>
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

          {/* ── Recent Wins ─────────────────────────────────────────── */}
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

          {/* ── Patterns ────────────────────────────────────────────── */}
          <section>
            <h2 className="text-white font-semibold text-base mb-3">Patterns We've Noticed</h2>
            {patterns.length === 0 ? (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                Patterns emerge after a few reflections.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {patterns.map((p, i) => {
                  const colorClass =
                    p.pattern_type === 'blocker'
                      ? 'bg-red-950 border-red-800 text-red-300'
                      : p.pattern_type === 'strength'
                      ? 'bg-green-950 border-green-800 text-green-300'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300';
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs ${colorClass}`}
                    >
                      {p.label}
                      <span className="opacity-60">×{p.occurrence_count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      </div>
    </AppShellV2>
  );
}
