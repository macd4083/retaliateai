import React, { useState } from 'react';
import { Target, Plus, CheckCircle2, Circle, Clock, TrendingUp, AlertCircle } from 'lucide-react';

export default function Goals() {
  const [activeView, setActiveView] = useState('active'); // 'active', 'completed', 'all'

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Target className="w-8 h-8 text-blue-600" />
              Goals
            </h1>
            <p className="text-slate-600 mt-1">Track progress.  Take action. Achieve results.</p>
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            New Goal
          </button>
        </div>

        {/* View Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-200">
          {['active', 'completed', 'all'].map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`px-4 py-2 font-medium capitalize transition-colors ${
                activeView === view
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {view}
            </button>
          ))}
        </div>

        {/* Goals Grid */}
        <div className="grid gap-6">
          {/* Example Goal Card - you'll map over real data */}
          <GoalCard
            title="Launch new product feature"
            description="Build and ship the AI journaling insights dashboard"
            progress={65}
            momentum="accelerating"
            nextSteps={[
              'Finish UI mockups',
              'Set up backend API',
              'User testing session',
            ]}
            recentActivity={3}
            daysActive={12}
          />
        </div>
      </div>
    </div>
  );
}

function GoalCard({ title, description, progress, momentum, nextSteps, recentActivity, daysActive }) {
  const momentumConfig = {
    accelerating: { color: 'text-green-600', bg: 'bg-green-50', icon: TrendingUp },
    steady:  { color: 'text-blue-600', bg: 'bg-blue-50', icon: Clock },
    stalled: { color: 'text-orange-600', bg: 'bg-orange-50', icon: AlertCircle },
  };

  const config = momentumConfig[momentum] || momentumConfig.steady;
  const MomentumIcon = config.icon;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-slate-900 mb-1">{title}</h3>
          <p className="text-slate-600 text-sm">{description}</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${config.bg}`}>
          <MomentumIcon className={`w-4 h-4 ${config.color}`} />
          <span className={`text-sm font-medium ${config.color} capitalize`}>{momentum}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">Progress</span>
          <span className="text-sm font-semibold text-slate-900">{progress}%</span>
        </div>
        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-4 text-sm text-slate-600">
        <div>
          <span className="font-medium">{recentActivity}</span> journal entries this week
        </div>
        <div>•</div>
        <div>
          <span className="font-medium">{daysActive}</span> days active
        </div>
      </div>

      {/* Next Steps */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Next Steps</h4>
        <div className="space-y-2">
          {nextSteps. slice(0, 3).map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <Circle className="w-4 h-4 text-slate-400" />
              <span className="text-slate-700">{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 pt-4 border-t border-slate-200 flex gap-2">
        <button className="flex-1 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">
          View Details
        </button>
        <button className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg">
          •••
        </button>
      </div>
    </div>
  );
}