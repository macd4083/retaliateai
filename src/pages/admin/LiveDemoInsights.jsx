import React, { useState, useEffect } from 'react';
import AppShellV2 from '../../components/v2/AppShellV2';
import {
  LIVE_DEMO_CHANNEL_NAME,
  buildLiveDemoChecklist,
  readLiveDemoData,
  readLiveDemoScript,
} from '../../lib/liveDemo';

function scoreLabel(score) {
  if (score >= 80) return 'Strong commitment follow-through';
  if (score >= 60) return 'Building momentum';
  if (score >= 40) return 'Room to grow';
  return 'Focus area';
}

export default function LiveDemoInsights() {
  const [demoData, setDemoData] = useState(readLiveDemoData());
  const [checklist, setChecklist] = useState([]);

  useEffect(() => {
    const nextScript = readLiveDemoScript();
    setDemoData(readLiveDemoData());
    setChecklist(buildLiveDemoChecklist(nextScript, nextScript.turns.length));
  }, []);

  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel(LIVE_DEMO_CHANNEL_NAME);
      channel.onmessage = (e) => {
        if (e.data?.type === 'UPDATE_DEMO_DATA' || e.data?.type === 'UPDATE_DEMO_SCRIPT') {
          const nextScript = readLiveDemoScript();
          setDemoData(readLiveDemoData());
          setChecklist(buildLiveDemoChecklist(nextScript, nextScript.turns.length));
        }
      };
    } catch {
      // BroadcastChannel not supported
    }
    return () => {
      if (channel) channel.close();
    };
  }, []);

  const goals = Array.isArray(demoData?.goals) ? demoData.goals : [];
  const commitmentScore = demoData?.commitmentScore ?? null;

  const hasData = commitmentScore !== null || checklist.length > 0 || goals.length > 0;

  return (
    <AppShellV2 title="Insights" shellMode="live-demo-user">
      <div className="h-full overflow-y-auto px-4 py-6 space-y-6">

        {!hasData && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <p className="text-zinc-400 text-sm">No demo insights available yet.</p>
            <p className="text-zinc-500 text-xs">Complete your reflection and set a few goals to see insights here.</p>
          </div>
        )}

        {/* Commitment Score */}
        {commitmentScore !== null && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-3">
            <h3 className="text-white font-semibold text-base">Commitment Score</h3>
            <p className="text-5xl font-bold text-white">
              {commitmentScore}<span className="text-2xl text-zinc-400 font-normal">/100</span>
            </p>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all"
                style={{ width: `${commitmentScore}%` }}
              />
            </div>
            <p className="text-zinc-400 text-sm">{scoreLabel(commitmentScore)}</p>
          </div>
        )}

        {/* Today's Checklist */}
        {checklist.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-3">
            <h3 className="text-white font-semibold text-base">Today&apos;s Checklist</h3>
            <ul className="space-y-2">
              {checklist.map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-base">{item.checked ? '✅' : '⬜'}</span>
                  <span className="text-zinc-200 text-sm">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Goals */}
        {goals.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-white font-semibold text-base">Your Goals</h3>
            {goals.map((goal, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🎯</span>
                  <p className="text-white font-medium text-sm">{goal.title}</p>
                </div>
                {goal.why && (
                  <div className="space-y-1">
                    <p className="text-zinc-500 text-xs uppercase tracking-widest">Why this matters</p>
                    <p className="text-zinc-400 text-xs italic">{goal.why}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </AppShellV2>
  );
}
