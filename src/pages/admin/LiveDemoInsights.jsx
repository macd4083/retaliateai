import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase/client';
import AppShellV2 from '../../components/v2/AppShellV2';

const DEMO_DATA_KEY = 'retaliateai_live_demo_data';
const DEMO_SCRIPT_KEY = 'retaliateai_live_demo_script';
const CHANNEL_NAME = 'retaliateai-live-demo';

function readDemoData() {
  try {
    const raw = window.localStorage.getItem(DEMO_DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readChecklistFromScript() {
  try {
    const raw = window.localStorage.getItem(DEMO_SCRIPT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.turns)) {
      return Array.isArray(parsed.checklist) ? parsed.checklist : [];
    }
    return [];
  } catch {
    return [];
  }
}

function scoreLabel(score) {
  if (score >= 80) return 'Strong commitment follow-through';
  if (score >= 60) return 'Building momentum';
  if (score >= 40) return 'Room to grow';
  return 'Focus area';
}

export default function LiveDemoInsights() {
  const auth = /** @type {any} */ (useAuth());
  const user = auth?.user;
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(null);
  const [demoData, setDemoData] = useState(null);
  const [checklist, setChecklist] = useState([]);

  // Admin guard
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.role === 'admin') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate('/reflection', { replace: true });
        }
      })
      .catch(() => {
        setIsAdmin(false);
        navigate('/reflection', { replace: true });
      });
  }, [user?.id]);

  // Load initial data from localStorage
  useEffect(() => {
    setDemoData(readDemoData());
    setChecklist(readChecklistFromScript());
  }, []);

  // BroadcastChannel listener
  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (e) => {
        if (e.data?.type === 'UPDATE_DEMO_DATA') {
          setDemoData(readDemoData());
        }
      };
    } catch {
      // BroadcastChannel not supported
    }
    return () => {
      if (channel) channel.close();
    };
  }, []);

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  const goals = Array.isArray(demoData?.goals) ? demoData.goals : [];
  const commitmentScore = demoData?.commitmentScore ?? null;

  const hasData = commitmentScore !== null || checklist.length > 0 || goals.length > 0;

  return (
    <AppShellV2 title="Insights">
      <div className="h-full overflow-y-auto px-4 py-6 space-y-6">

        {!hasData && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <p className="text-zinc-400 text-sm">No demo data configured yet.</p>
            <p className="text-zinc-500 text-xs">Go to Admin → Live Demo Script to set it up.</p>
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
