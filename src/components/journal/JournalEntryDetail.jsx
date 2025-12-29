import React from 'react';
import { X, Calendar, Sparkles, TrendingUp } from 'lucide-react';

export default function JournalEntryDetail({ entry, onClose }) {
  if (!entry) return null;

  // Combine insights and patterns
  const allInsights = [
    ...(entry.insights || []),
    ...(entry.patterns || []),
  ].filter(Boolean);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-200">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {entry.title || 'Journal Entry'}
            </h2>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(entry.created_at)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Original Entry */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-3">Your Entry</h3>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                {entry.content}
              </p>
            </div>
          </div>

          {/* AI Summary */}
          {entry.summary && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-blue-900">AI Summary</h3>
              </div>
              <p className="text-blue-800 leading-relaxed">{entry.summary}</p>
            </div>
          )}

          {/* Insights & Patterns */}
          {allInsights.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-purple-900">
                  AI Insights & Suggestions
                </h3>
              </div>
              <ul className="space-y-3">
                {allInsights.map((insight, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 text-purple-800"
                  >
                    <span className="flex-shrink-0 w-6 h-6 bg-purple-200 text-purple-700 rounded-full flex items-center justify-center text-sm font-semibold mt-0.5">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed">{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Mood (if present) */}
          {entry. mood_rating && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="font-medium">Mood: </span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <span
                    key={rating}
                    className={`text-2xl ${
                      rating <= entry.mood_rating ?  'opacity-100' : 'opacity-20'
                    }`}
                  >
                    {rating <= 2 ? '😢' : rating === 3 ? '😐' : '😊'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags (if present) */}
          {entry.tags && entry.tags. length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">Tags</h4>
              <div className="flex flex-wrap gap-2">
                {entry.tags. map((tag, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 bg-slate-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}