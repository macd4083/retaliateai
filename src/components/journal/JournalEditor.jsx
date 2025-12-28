import React, { useState } from 'react';

export default function JournalEditor({ entry = null, onSave, onCancel, isSaving = false }) {
  const [formData, setFormData] = useState({
    title: entry?.title || '',
    content: entry?.content || '',
    mood_rating: entry?.mood_rating || 5,
    tags:  entry?.tags || [],
  });
  const [tagInput, setTagInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.content.trim()) {
      alert('Please write something in your entry.');
      return;
    }
    onSave(formData);
  };

  const handleAddTag = () => {
    const tag = tagInput. trim().toLowerCase();
    if (tag && !formData.tags. includes(tag)) {
      setFormData({ ...formData, tags: [...formData.tags, tag] });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData({
      ... formData,
      tags: formData.tags.filter((tag) => tag !== tagToRemove),
    });
  };

  const wordCount = formData.content.split(/\s+/).filter(Boolean).length;

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
              onChange={(e) => setFormData({ ...formData, title: e.target. value })}
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

          {/* Metadata */}
          <div className="p-6 bg-slate-50 border-t border-slate-200 space-y-6">
            {/* Mood Rating */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Mood:  {formData.mood_rating}/10
              </label>
              <div className="flex items-center gap-4">
                <span className="text-2xl">😢</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={formData.mood_rating}
                  onChange={(e) =>
                    setFormData({ ... formData, mood_rating: parseInt(e.target.value) })
                  }
                  className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <span className="text-2xl">😊</span>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Tags</label>
              <div className="flex gap-2 mb-3 flex-wrap">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-blue-900"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 text-sm font-medium"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Word Count */}
            <div className="text-sm text-slate-500">
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 bg-white border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="px-6 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !formData.content. trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSaving ? 'Saving...' : entry ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </form>

        {isSaving && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 text-sm">
              ✨ Generating AI summary and analyzing patterns... 
            </p>
          </div>
        )}
      </div>
    </div>
  );
}