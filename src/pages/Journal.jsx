import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useJournalEntries, useCreateJournalEntry, useUpdateJournalEntry, useDeleteJournalEntry } from '@/hooks';
import EntrySidebar from '@/components/journal/EntrySidebar';
import JournalEditor from '@/components/journal/JournalEditor';
import EntryDetailModal from '@/components/journal/EntryDetailModal';
import { aiWorkflows } from '@/lib/ai/workflows';

export default function Journal() {
  const { user } = useAuth();
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [viewingEntry, setViewingEntry] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { data: entries = [], isLoading, error } = useJournalEntries(user?. id);
  const createEntry = useCreateJournalEntry(user?.id);
  const updateEntry = useUpdateJournalEntry();
  const deleteEntry = useDeleteJournalEntry();

  const handleSave = async (entryData) => {
    setIsSaving(true);
    try {
      const result = await createEntry.mutateAsync(entryData);
      
      // Auto-open the modal with AI insights and ephemeral follow-up questions
      if (result?. entry) {
        setTimeout(() => {
          setViewingEntry({
            ...result.entry,
            follow_up_questions: result.followUpQuestions,
          });
        }, 300);
      }
    } catch (error) {
      console.error('Failed to save entry:', error);
      alert('Failed to save entry. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitFollowUp = async (entryId, answers) => {
    try {
      // Get the current entry
      const currentEntry = entries.find((e) => e.id === entryId);
      if (!currentEntry) throw new Error('Entry not found');

      // Append answers to content (answers only, no questions)
      const answersText = '\n\n' + answers.join('\n\n');
      const updatedContent = currentEntry.content + answersText;

      // Generate new embedding for updated content
      const embeddingResponse = await fetch('/api/generate-embedding', {
        method:  'POST',
        headers:  { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: updatedContent }),
      });

      if (!embeddingResponse. ok) {
        throw new Error('Failed to generate embedding');
      }

      const { embedding } = await embeddingResponse. json();

      // Search for similar entries with new embedding
      const similarResponse = await fetch('/api/search-similar-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user. id,
          embedding,
          limit: 15,
        }),
      });

      if (!similarResponse.ok) {
        throw new Error('Failed to search similar entries');
      }

      const { entries: similarEntries } = await similarResponse.json();

      // Get user profile
      let userProfile;
      try {
        const { data: profile } = await fetch(`/api/user-profile?user_id=${user.id}`);
        userProfile = profile?. summary_text || 'No profile yet.  This is a new user.';
      } catch (error) {
        userProfile = 'No profile yet. This is a new user. ';
      }

      // Re-analyze with updated content
      const analysisResponse = await fetch('/api/analyze-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_entry: updatedContent,
          past_summaries: similarEntries.map(e => e.summary).filter(Boolean),
          user_profile: userProfile,
        }),
      });

      if (!analysisResponse. ok) {
        throw new Error('Failed to analyze entry');
      }

      const analysis = await analysisResponse.json();

      // Update the entry in the database
      await updateEntry.mutateAsync({
        entryId: entryId,
        entryData: {
          content:  updatedContent,
          summary:  analysis.summary,
          insights: analysis.insights,
          embedding: embedding,
        }
      });

      // Update the viewing entry to show new insights (no more follow-up questions)
      setViewingEntry({
        ... currentEntry,
        content: updatedContent,
        insights: analysis.insights,
        follow_up_questions: null,
      });
    } catch (error) {
      console.error('Failed to process follow-up:', error);
      throw error;
    }
  };

  const handleDelete = async (entryId) => {
    try {
      await deleteEntry. mutateAsync(entryId);
      if (viewingEntry?. id === entryId) {
        setViewingEntry(null);
      }
    } catch (error) {
      console.error('Failed to delete entry:', error);
      alert('Failed to delete entry. Please try again.');
    }
  };

  const handleEdit = (entry) => {
    setSelectedEntry(entry);
    setViewingEntry(null);
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
    <div className="h-full flex">
      {/* Entry List Sidebar */}
      <EntrySidebar
        entries={entries}
        selectedEntryId={viewingEntry?.id}
        onSelectEntry={setViewingEntry}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main Content Area - Always show editor */}
      <div className="flex-1 bg-slate-50">
        <JournalEditor
          entry={selectedEntry}
          onSave={handleSave}
          onCancel={() => setSelectedEntry(null)}
          isSaving={isSaving}
        />
      </div>

      {/* Entry Detail Modal */}
      {viewingEntry && (
        <EntryDetailModal
          entry={viewingEntry}
          onClose={() => setViewingEntry(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSubmitFollowUp={handleSubmitFollowUp}
        />
      )}
    </div>
  );
}