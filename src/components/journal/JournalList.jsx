import React, { useState } from 'react';

export default function JournalList({ entries, onEdit, onDelete }) {
  const [expandedId, setExpandedId] = useState(null);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const getMoodEmoji = (rating) => {
    if (rating >= 9) return '😄';
    if (rating >= 7) return '🙂';
    if (rating >= 5) return '😐';
    if (rating >= 3) return '😕';
    return '😢';
  };

  const toggleExpand = (entryId) => {
    setExpandedId(expandedId === entryId ? null : entryId);
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-4">
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.id;

          return (
            <div
              key={entry.id}
              className="bg-white border border-slate-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Collapsed View - Title and Date Only */}
              <div
                onClick={() => toggleExpand(entry. id)}
                className="p-6 cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-slate-900 mb-1">
                      {entry.title || 'Untitled Entry'}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {formatDate(entry.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    {entry.mood_rating && (
                      <span className="text-2xl" title={`Mood: ${entry.mood_rating}/10`}>
                        {getMoodEmoji(entry.mood_rating)}
                      </span>
                    )}
                    <span className="text-slate-400">
                      {isExpanded ? '▼' :  '▶'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded View - Full Content */}
              {isExpanded && (
                <div className="px-6 pb-6 border-t border-slate-100">
                  {/* Full Content */}
                  <div className="mt-6 mb-6">
                    <div className="prose prose-slate max-w-none">
                      <div className="whitespace-pre-wrap text-slate-800 text-base leading-relaxed">
                        {entry.content}
                      </div>
                    </div>
                  </div>

                  {/* Tags */}
                  {entry.tags && entry.tags. length > 0 && (
                    <div className="flex gap-2 mb-6 flex-wrap">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* AI Summary Section */}
                  {entry. summary && (
                    <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">✨</span>
                        <h4 className="text-sm font-semibold text-slate-700">AI Summary</h4>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {entry.summary}
                      </p>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span>{entry.word_count} words</span>
                      {entry.mood_rating && (
                        <span>Mood: {entry.mood_rating}/10</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(entry);
                        }}
                        className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(entry.id);
                        }}
                        className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}