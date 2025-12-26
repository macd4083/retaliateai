import React, { useState } from 'react';
import { Target, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const categoryColors = {
  health: 'bg-emerald-100 text-emerald-700',
  career: 'bg-blue-100 text-blue-700',
  relationships: 'bg-rose-100 text-rose-700',
  personal_growth: 'bg-violet-100 text-violet-700',
  financial: 'bg-amber-100 text-amber-700',
  creative: 'bg-pink-100 text-pink-700',
  other: 'bg-slate-100 text-slate-700',
};

export default function TrackedGoals({ goals, progressNotes, onProgressChange, onDeactivate }) {
  if (goals.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-900">Daily Goal Check-in</h3>
        </div>
        <p className="text-xs text-slate-400">Track your progress</p>
      </div>

      <div className="space-y-3">
        {goals.map((goal) => (
          <div key={goal.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium text-slate-900">{goal.title}</h4>
                  {goal.category && (
                    <Badge className={`${categoryColors[goal.category]} border-0 text-xs`}>
                      {goal.category.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                {goal.description && (
                  <p className="text-xs text-slate-500">{goal.description}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDeactivate(goal.id)}
                className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                title="Deactivate goal"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <Textarea
              placeholder="How did you progress on this goal today? Any wins or challenges?"
              value={progressNotes[goal.id] || ''}
              onChange={(e) => onProgressChange(goal.id, e.target.value)}
              className="text-sm min-h-[80px] resize-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
