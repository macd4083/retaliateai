import React from 'react';
import { Target, Sparkles, X } from 'lucide-react';

export default function GoalSuggestion({ suggestion, onAccept, onDismiss }) {
  if (!suggestion) return null;

  return (
    <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-5">
      <div className="flex items-start gap-4">
        <div className="p-2 bg-purple-100 rounded-lg">
          <Target className="w-5 h-5 text-purple-600" />
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-purple-900">AI Suggested Goal</h3>
          </div>
          
          <h4 className="text-lg font-semibold text-slate-900 mb-1">
            {suggestion.title}
          </h4>
          
          <p className="text-sm text-slate-700 mb-2">
            {suggestion.description}
          </p>
          
          <p className="text-xs text-purple-700 italic">
            Why this matters:  {suggestion.why_it_matters}
          </p>
          
          <div className="flex gap-2 mt-4">
            <button
              onClick={onAccept}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium text-sm transition-colors"
            >
              Accept Goal
            </button>
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-slate-600 hover:bg-white/50 rounded-lg font-medium text-sm transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 hover:bg-purple-100 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 text-purple-600" />
        </button>
      </div>
    </div>
  );
}