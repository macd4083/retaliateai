import React, { useState } from 'react';
import { X, Sparkles, Calendar, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function EntryDetailModal({ entry, onClose, onEdit, onDelete, onSubmitFollowUp }) {
  const [followUpAnswers, setFollowUpAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasFollowUpQuestions = entry. follow_up_questions && entry.follow_up_questions.length > 0;

  const handleSubmitFollowUp = async () => {
    const answers = Object.values(followUpAnswers).filter(Boolean);
    if (answers.length === 0) return;

    setIsSubmitting(true);
    try {
      await onSubmitFollowUp(entry. id, answers);
      setFollowUpAnswers({});
    } catch (error) {
      console.error('Failed to submit follow-up:', error);
      alert('Failed to submit reflection. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="w-4 h-4 text-slate-500" />
                <p className="text-sm text-slate-600">
                  {format(new Date(entry.created_at), 'EEEE, MMMM d, yyyy · h:mm a')}
                </p>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">
                {entry.title || 'Journal Entry'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-250px)] space-y-6">
          {/* Entry Content */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Your Entry</h3>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">
                {entry.content}
              </p>
            </div>
          </div>

          {/* AI Insights */}
          {entry.insights && entry.insights.length > 0 && (
            <div className="p-4 bg-violet-50 border border-violet-200 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-semibold text-violet-900">AI Insights & Suggestions</h3>
              </div>
              <ul className="space-y-2">
                {entry.insights.map((insight, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-violet-600 mt-0.5">•</span>
                    <span className="text-sm text-violet-800 leading-relaxed">{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Related Goals (placeholder for future) */}
          {/* TODO: Add related goals section when goals feature is built */}

          {/* Follow-Up Questions */}
          {hasFollowUpQuestions && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-amber-900">Let's go deeper...</h3>
              </div>
              <p className="text-xs text-amber-700 mb-4">
                Answer these questions to reflect more deeply on your entry
              </p>
              <div className="space-y-4">
                {entry.follow_up_questions.map((question, index) => (
                  <div key={index}>
                    <label className="block text-sm font-medium text-amber-900 mb-2">
                      {index + 1}. {question}
                    </label>
                    <textarea
                      value={followUpAnswers[index] || ''}
                      onChange={(e) =>
                        setFollowUpAnswers({ ...followUpAnswers, [index]: e.target.value })
                      }
                      placeholder="Your reflection..."
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[80px] resize-none"
                      disabled={isSubmitting}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={handleSubmitFollowUp}
                disabled={isSubmitting || Object.values(followUpAnswers).every((a) => !a)}
                className="mt-4 w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  'Submit Deeper Reflection'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(entry)}
              className="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete this entry?')) {
                  onDelete(entry.id);
                  onClose();
                }
              }}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}