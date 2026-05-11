import React, { useState, useEffect } from 'react';
import AppShellV2 from '../../components/v2/AppShellV2';
import {
  LIVE_DEMO_CHANNEL_NAME,
  readLiveDemoData,
  readLiveDemoScript,
} from '../../lib/liveDemo';

const STRONG_SCORE_THRESHOLD = 80;
const MEDIUM_SCORE_THRESHOLD = 60;
const WEEK_DAYS_COUNT = 7;
const SUNDAY_INDEX = 6;
const SATURDAY_INDEX = 5;
const DAYS_WITH_TRACKED_DATA = 6;

function localDateStr() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function LiveDemoInsights() {
  const [demoData, setDemoData] = useState(readLiveDemoData());
  const [selectedDayIndex, setSelectedDayIndex] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  function refreshDemoData() {
    readLiveDemoScript();
    setDemoData(readLiveDemoData());
  }

  useEffect(() => {
    refreshDemoData();
  }, []);

  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel(LIVE_DEMO_CHANNEL_NAME);
      channel.onmessage = (e) => {
        if (e.data?.type === 'UPDATE_DEMO_DATA' || e.data?.type === 'UPDATE_DEMO_SCRIPT') {
          refreshDemoData();
        }
      };
    } catch {
      // BroadcastChannel not supported
    }
    return () => {
      if (channel) channel.close();
    };
  }, []);

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const weeklyScores = Array.isArray(demoData?.weeklyScores) ? demoData.weeklyScores.slice(0, WEEK_DAYS_COUNT) : [];
  const streak = Number.isFinite(Number(demoData?.streak)) ? Math.max(0, Math.round(Number(demoData.streak))) : 0;
  const yesterdayCommitment = demoData?.yesterdayCommitment?.text ? demoData.yesterdayCommitment : null;
  const keptFragments = Array.isArray(demoData?.keptFragments) ? demoData.keptFragments : [];
  const missedFragments = Array.isArray(demoData?.missedFragments) ? demoData.missedFragments : [];
  const goals = Array.isArray(demoData?.goals) ? demoData.goals : [];
  const archivedGoals = Array.isArray(demoData?.archivedGoals) ? demoData.archivedGoals : [];
  const yesterdayDate = addDays(localDateStr(), -1);
  const hasWeeklyData = weeklyScores.length >= DAYS_WITH_TRACKED_DATA
    && weeklyScores.slice(0, DAYS_WITH_TRACKED_DATA).some((d) => d?.score !== null || d?.status);
  const clampDayIndex = (index) => Math.max(0, Math.min(SUNDAY_INDEX, index));
  const resolvedDayIndex = selectedDayIndex !== null ? clampDayIndex(selectedDayIndex) : SATURDAY_INDEX;

  const padX = 28;
  const baseline = 88;
  const chartTop = 12;
  const chartH = baseline - chartTop;
  const totalW = 320;
  const xStep = (totalW - 2 * padX) / (WEEK_DAYS_COUNT - 1);
  const getX = (i) => padX + i * xStep;
  const getY = (score) => (score === null ? baseline : baseline - (score / 100) * chartH);

  const weekDays = Array.from({ length: WEEK_DAYS_COUNT }, (_, i) => {
    const source = i === SUNDAY_INDEX ? null : weeklyScores[i];
    const rawScore = source && typeof source === 'object' ? source.score : null;
    const rawStatus = source && typeof source === 'object' ? source.status : null;
    const score = Number.isFinite(Number(rawScore)) ? Number(rawScore) : null;
    const status = ['kept', 'missed', 'pending'].includes(rawStatus) ? rawStatus : null;
    return {
      label: dayLabels[i],
      score,
      status,
      hasCommitment: score !== null || status !== null,
    };
  });

  const lineParts = [];
  weekDays.forEach((d, i) => {
    if (d.score === null) return;
    const x = getX(i).toFixed(1);
    const y = getY(d.score).toFixed(1);
    lineParts.push(lineParts.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  });

  function dotColor(day, isSelected) {
    if (!day.hasCommitment) return '#27272a';
    if (day.status === 'missed') return '#52525b';
    if (day.status === 'pending') return '#f97316';
    if (day.status === 'kept') {
      if (isSelected) return '#ef4444';
      if (day.score != null && day.score >= STRONG_SCORE_THRESHOLD) return '#fb7185';
      if (day.score != null && day.score >= MEDIUM_SCORE_THRESHOLD) return '#fdba74';
      return '#fca5a5';
    }
    return '#71717a';
  }

  function signalBadge(signal) {
    if (signal === 'strong') return { dot: 'bg-green-500', text: 'Strong momentum' };
    if (signal === 'medium') return { dot: 'bg-yellow-400', text: 'Building' };
    if (signal === 'low') return { dot: 'bg-orange-500', text: 'Needs attention' };
    if (signal === 'struggling') return { dot: 'bg-red-500', text: 'Struggling' };
    return { dot: 'bg-yellow-400', text: 'Building' };
  }

  return (
    <AppShellV2 title="Insights" shellMode="live-demo-user">
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-white font-semibold text-lg mb-4">Consistency Tracker</p>
            {hasWeeklyData ? (
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
                  if (i === SUNDAY_INDEX) return null;
                  const x = getX(i);
                  const y = getY(d.score);
                  const isSelected = i === resolvedDayIndex;
                  return (
                    <g
                      key={`day-${i}`}
                      onClick={() => setSelectedDayIndex(clampDayIndex(i))}
                      tabIndex={0}
                      onFocus={() => setSelectedDayIndex(clampDayIndex(i))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedDayIndex(clampDayIndex(i));
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
            ) : (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">No data yet</p>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-white font-semibold text-lg">{streak} night streak</p>
              <p className="text-zinc-500 text-sm">Keep showing up.</p>
            </div>
          </div>

          {yesterdayCommitment && (
            <div>
              <h2 className="text-white font-semibold text-base mb-3">Commitments</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="flex-shrink-0 mt-0.5">
                    {yesterdayCommitment.status === 'kept' ? '✅' : yesterdayCommitment.status === 'missed' ? '❌' : '⏳'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-200 text-sm leading-snug">{yesterdayCommitment.text}</p>
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
                      {formatDate(yesterdayDate)} · {yesterdayCommitment.status === 'kept' ? 'Kept' : yesterdayCommitment.status === 'missed' ? 'Missed' : 'Pending — check back tomorrow'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <section>
            <h2 className="text-white font-semibold text-base mb-3">Kept</h2>
            {keptFragments.length > 0 ? (
              <div className="space-y-2">
                {keptFragments.map((f, i) => (
                  <div key={`kept-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                    <p className="text-zinc-200 text-sm leading-relaxed">
                      {f.text}
                      {f.goalTitle && (
                        <span className="text-zinc-500">
                          {' '}— related to your {f.goalTitle} goal
                          {f.goalWhy && `, it was important because ${f.goalWhy}`}
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

          <section>
            <h2 className="text-white font-semibold text-base mb-3">Missed</h2>
            {missedFragments.length > 0 ? (
              <div className="space-y-2">
                {missedFragments.map((f, i) => (
                  <div key={`missed-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                    <p className="text-zinc-200 text-sm leading-relaxed">
                      {f.text}
                      {f.goalTitle && (
                        <span className="text-zinc-500">
                          {' '}— related to your {f.goalTitle} goal
                          {f.goalWhy && `, it was important because ${f.goalWhy}`}
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

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold text-base">Your Goals</h2>
              <button
                className="text-zinc-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
                disabled
              >
                + Add
              </button>
            </div>

            {goals.length === 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <p className="text-zinc-500 text-sm">No active goals yet.</p>
              </div>
            )}

            {goals.length > 0 && (
              <div className="space-y-3">
                {goals.map((goal, i) => {
                  return (
                    <div key={`goal-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-lg mt-0.5 self-start">🎯</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium text-sm leading-snug">{goal?.title}</p>
                          {goal?.baseline_snapshot && (
                            <p className="text-zinc-500 text-xs mt-1 leading-relaxed">
                              Started: <span className="text-zinc-400">{goal.baseline_snapshot}</span>
                            </p>
                          )}
                          {goal?.why ? (
                            <div className="mt-2 space-y-1.5">
                              <p className="text-zinc-500 text-xs uppercase tracking-widest">Why this matters</p>
                              <div className="flex items-start gap-1.5">
                                <span className="text-zinc-600 text-xs mt-0.5 flex-shrink-0">"</span>
                                <p className="text-zinc-400 text-xs leading-relaxed italic flex-1">{goal.why}</p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-zinc-600 text-xs mt-1 italic">No why yet — talk about this in your next session</p>
                          )}
                        </div>
                        <button
                          className="flex-shrink-0 text-zinc-500 hover:text-white transition-colors self-center"
                          disabled
                          title="Actions"
                        >
                          ⋯
                        </button>
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

            {showArchived && archivedGoals.length > 0 && (
              <div className="mt-3 space-y-3">
                {archivedGoals.map((goal, i) => (
                  <div key={`archived-goal-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 opacity-80">
                    <div className="flex items-start gap-3">
                      <span className="text-lg mt-0.5 self-start">🎯</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-300 font-medium text-sm leading-snug">{goal?.title}</p>
                        <p className="text-xs mt-0.5 text-zinc-500">{goal?.status || 'Archived'}</p>
                      </div>
                      <button
                        className="flex-shrink-0 text-zinc-500 hover:text-white transition-colors self-center"
                        disabled
                        title="Actions"
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="h-6" />
        </div>
      </div>
    </AppShellV2>
  );
}
