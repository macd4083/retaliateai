import React from 'react';
import { Sparkles, TrendingUp, Calendar, Target } from "lucide-react";

export default function ProgressSummary({ summary, stats }) {
  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 text-white">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-white/10 rounded-xl">
          <Sparkles className="w-5 h-5 text-violet-300" />
        </div>
        <h2 className="font-semibold text-lg">Your Progress Summary</h2>
      </div>
      
      <p className="text-slate-300 leading-relaxed mb-6">{summary}</p>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/10 rounded-xl p-4 text-center">
          <Calendar className="w-5 h-5 mx-auto mb-2 text-blue-300" />
          <p className="text-2xl font-bold">{stats?.totalEntries || 0}</p>
          <p className="text-xs text-slate-400">Total Entries</p>
        </div>
        <div className="bg-white/10 rounded-xl p-4 text-center">
          <TrendingUp className="w-5 h-5 mx-auto mb-2 text-emerald-300" />
          <p className="text-2xl font-bold">{stats?.streak || 0}</p>
          <p className="text-xs text-slate-400">Day Streak</p>
        </div>
        <div className="bg-white/10 rounded-xl p-4 text-center">
          <Target className="w-5 h-5 mx-auto mb-2 text-violet-300" />
          <p className="text-2xl font-bold">{stats?.activeGoals || 0}</p>
          <p className="text-xs text-slate-400">Active Goals</p>
        </div>
      </div>
    </div>
  );
}
