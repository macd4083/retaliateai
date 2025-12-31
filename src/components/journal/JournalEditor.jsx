import React, { useState } from 'react';

export default function JournalEditor({ entry = null, onSave, onCancel, isSaving = false }) {
  const [formData, setFormData] = useState({
    title:  entry?.title || '',
    content: entry?.content || '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.content.trim()) {
      alert('Please write something in your entry.');
      return;
    }
    onSave(formData);
  };

  return (
    <div className="h-full bg-slate-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-8">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {/* Title */}
          <div className="p-6 border-b border-slate-200">
            <input
              type="text"
              placeholder="Entry title (optional)"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full text-2xl font-semibold text-slate-900 placeholder-slate-400 focus:outline-none"
            />
          </div>

          {/* Content */}
          <div className="p-6">
            <textarea
              placeholder="What's on your mind?  Write freely..."
              value={formData.content}
              onChange={(e) => setFormData({ ... formData, content: e.target.value })}
              className="w-full h-96 text-lg text-slate-800 placeholder-slate-400 focus: outline-none resize-none"
              autoFocus
            />
          </div>

          {/* Actions */}
          <div className="p-6 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="px-6 py-2.5 text-slate-700 hover:bg-slate-100 rounded-lg font-medium disabled: opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !formData.content.trim()}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                'Save Entry'
              )}
            </button>
          </div>
        </form>

        {isSaving && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 text-sm flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              ✨ Generating AI summary and analyzing patterns...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}