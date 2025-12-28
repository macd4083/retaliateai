import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useJournalEntries, useCreateJournalEntry, useDeleteJournalEntry } from '@/hooks';
import JournalEditor from '@/components/journal/JournalEditor';
import JournalList from '@/components/journal/JournalList';
import JournalFilters from '@/components/journal/JournalFilters';

export default function Journal() {
  const { user } = useAuth();
  const [isWriting, setIsWriting] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [filters, setFilters] = useState({
    searchQuery: '',
    sortBy: 'created_at',
    sortOrder:  'desc',
  });

  // Fetch journal entries
  const { data: entries = [], isLoading, error } = useJournalEntries(user?. id);

  // Mutations
  const createEntry = useCreateJournalEntry(user?.id);
  const deleteEntry = useDeleteJournalEntry();

  // Filter and sort entries
  const filteredEntries = entries
    .filter((entry) => {
      if (! filters.searchQuery) return true;
      const query = filters.searchQuery.toLowerCase();
      return (
        entry. title?. toLowerCase().includes(query) ||
        entry.content?.toLowerCase().includes(query) ||
        entry.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    })
    .sort((a, b) => {
  const order = filters.sortOrder === 'asc' ? 1 : -1;
  if (filters.sortBy === 'created_at') {
    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * order;
  }
  if (filters.sortBy === 'mood_rating') {
    return ((a.mood_rating || 0) - (b.mood_rating || 0)) * order;
  }
  return 0;
});

  const handleSave = async (entryData) => {
    try {
      await createEntry.mutateAsync(entryData);
      setIsWriting(false);
      setSelectedEntry(null);
    } catch (error) {
      console.error('Failed to save entry:', error);
      alert('Failed to save entry. Please try again.');
    }
  };

  const handleDelete = async (entryId) => {
    if (! confirm('Are you sure you want to delete this entry?')) return;

    try {
      await deleteEntry. mutateAsync(entryId);
    } catch (error) {
      console.error('Failed to delete entry:', error);
      alert('Failed to delete entry. Please try again.');
    }
  };

  const handleEdit = (entry) => {
    setSelectedEntry(entry);
    setIsWriting(true);
  };

  const handleCancel = () => {
    setIsWriting(false);
    setSelectedEntry(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading your journal...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-red-800 font-semibold mb-2">Error loading journal</h2>
          <p className="text-red-600">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Journal</h1>
            <p className="text-slate-600 mt-1">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
          <button
            onClick={() => setIsWriting(true)}
            disabled={isWriting}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
          >
            ✍️ New Entry
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {isWriting ? (
          <JournalEditor
            entry={selectedEntry}
            onSave={handleSave}
            onCancel={handleCancel}
            isSaving={createEntry.isPending}
          />
        ) : (
          <div className="h-full flex flex-col">
            {/* Filters */}
            <JournalFilters filters={filters} onFiltersChange={setFilters} />

            {/* Entries List */}
            <div className="flex-1 overflow-y-auto">
              {filteredEntries.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-md">
                    <div className="text-6xl mb-4">📔</div>
                    <h2 className="text-2xl font-semibold text-slate-900 mb-2">
                      {entries.length === 0 ? 'Start Your Journal' : 'No matching entries'}
                    </h2>
                    <p className="text-slate-600 mb-6">
                      {entries.length === 0
                        ? 'Write your first entry to begin your journey of self-reflection.'
                        : 'Try adjusting your search or filters. '}
                    </p>
                    {entries.length === 0 && (
                      <button
                        onClick={() => setIsWriting(true)}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                      >
                        Write First Entry
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <JournalList
                  entries={filteredEntries}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}