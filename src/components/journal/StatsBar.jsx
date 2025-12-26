import React from 'react';
import { BookOpen, Flame } from 'lucide-react';

export default function StatsBar({ stats }) {
  return (
    <div className="flex items-center justify-center gap-8 py-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-100 rounded-lg">
          <BookOpen className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{stats.totalEntries}</p>
          <p className="text-xs text-slate-500">Total Entries</p>
        </div>
      </div>
      
      <div className="h-12 w-px bg-slate-200" />
      
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-100 rounded-lg">
          <Flame className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{stats.streak}</p>
          <p className="text-xs text-slate-500">Day Streak</p>
        </div>
      </div>
    </div>
  );
}
