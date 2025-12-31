import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useJournalEntries, useCreateJournalEntry, useUpdateJournalEntry, useDeleteJournalEntry } from '@/hooks';
import { useAuth } from '@/lib/AuthContext';
import Sidebar from '@/components/layout/Sidebar';
import JournalEditor from '@/components/journal/JournalEditor';
import EntryDetailModal from '@/components/journal/EntryDetailModal';

export default function App() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Determine activeTab from URL
  const getTabFromPath = (path) => {
    const pathMap = {
      '/Journal': 'journal',
      '/Insights': 'insights',
      '/Goals': 'goals',
      '/People': 'people',
      '/Users': 'users',
    };
    return pathMap[path] || 'journal';
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath(location.pathname));
  const [viewingEntry, setViewingEntry] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const { data: entries = [], isLoading, error } = useJournalEntries(user?.id);
  const createEntry = useCreateJournalEntry(user?.id);
  const updateEntry = useUpdateJournalEntry();
  const deleteEntry = useDeleteJournalEntry();

  // Update activeTab when URL changes
  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  // Handle tab changes and update URL
  const handleTabChange = (newTab) => {
    const tabToPathMap = {
      'journal': '/Journal',
      'insights': '/Insights',
      'goals': '/Goals',
      'people': '/People',
      'users': '/Users',
    };
    navigate(tabToPathMap[newTab] || '/Journal');
  };

  // When user clicks on an entry in the sidebar, show it in the modal
  const handleSelectEntry = (entry) => {
    setViewingEntry(entry);
  };

  // Mutations/handlers
  const handleSave = async (entryData) => {
    setIsSaving(true);
    try {
      const result = await createEntry.mutateAsync(entryData);
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
      const currentEntry = entries.find((e) => e.id === entryId);
      if (!currentEntry) throw new Error('Entry not found');
      
      const answersText = '\n\n--- Follow-up Reflections ---\n' + answers.join('\n\n');
      const updatedContent = currentEntry.content + answersText;

      // Only generate embedding if current entry has one
      let combinedEmbedding = null;
      
      if (currentEntry.embedding) {
        // Generate embedding for ONLY the new answers (more efficient)
        const newAnswersResponse = await fetch('/api/generate-embedding', {
          method:  'POST',
          headers:  { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: answersText }),
        });

        if (!newAnswersResponse. ok) {
          throw new Error('Failed to generate embedding for answers');
        }

        const { embedding:  newAnswersEmbedding } = await newAnswersResponse.json();

        // Combine embeddings (weighted by content length)
        const originalWeight = currentEntry.content.length;
        const newWeight = answersText.length;
        const totalWeight = originalWeight + newWeight;

        combinedEmbedding = currentEntry.embedding.map((val, i) => 
          (val * originalWeight + newAnswersEmbedding[i] * newWeight) / totalWeight
        );
      } else {
        // If no existing embedding, generate one for the full content
        const embeddingResponse = await fetch('/api/generate-embedding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:  JSON.stringify({ text: updatedContent }),
        });

        if (embeddingResponse.ok) {
          const { embedding } = await embeddingResponse.json();
          combinedEmbedding = embedding;
        }
      }

      // Search with combined embedding
      const similarResponse = await fetch('/api/search-similar-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:  JSON.stringify({
          user_id: user.id,
          embedding: combinedEmbedding,
          limit: 5,
        }),
      });

      if (!similarResponse.ok) {
        throw new Error('Failed to search similar entries');
      }

      const { entries: similarEntries } = await similarResponse.json();

      // Add temporal context to summaries
      const enrichedSummaries = similarEntries.map(e => {
        const daysAgo = Math.floor((Date.now() - new Date(e.created_at)) / (1000 * 60 * 60 * 24));
        return `[${daysAgo} days ago]: ${e.summary}`;
      });

      // Get user profile
      let userProfile;
      try {
        const response = await fetch(`/api/user-profile? user_id=${user.id}`);
        const { data: profile } = await response.json();
        userProfile = profile?.summary_text || 'No profile yet.  This is a new user.';
      } catch (error) {
        userProfile = 'No profile yet. This is a new user. ';
      }

      // Analyze with enriched data
      const analysisResponse = await fetch('/api/analyze-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_entry: updatedContent,
          past_summaries: enrichedSummaries,
          user_profile: userProfile,
        }),
      });

      if (!analysisResponse.ok) {
        throw new Error('Failed to analyze entry');
      }

      const analysis = await analysisResponse.json();

      // Update entry with new content and analysis
      const updateData = {
        content:  updatedContent,
        summary:  analysis.summary,
        insights: analysis.insights,
      };

      // Only include embedding if we have one
      if (combinedEmbedding) {
        updateData.embedding = combinedEmbedding;
      }

      // Update the entry in the database
      await updateEntry.mutateAsync({
        entryId: entryId,
        entryData: updateData,
      });

      // Update the viewing entry to show new content
      setViewingEntry({
        ...currentEntry,
        content: updatedContent,
        summary: analysis.summary,
        insights: analysis.insights,
        follow_up_questions: null,
      });
    } catch (error) {
      console.error('Failed to process follow-up:', error);
      alert('Failed to process reflection. Please try again.');
      throw error;
    }
  };

  const handleDelete = async (entryId) => {
    try {
      await deleteEntry.mutateAsync(entryId);
      if (viewingEntry?.id === entryId) {
        setViewingEntry(null);
      }
    } catch (error) {
      console.error('Failed to delete entry:', error);
      alert('Failed to delete entry. Please try again.');
    }
  };

  const handleEdit = (entry) => {
    // Close the modal and open the entry in the editor
    setViewingEntry(null);
    // You could add editing functionality here if needed
    // For now, we'll just close the modal
  };

  // If loading/error, show loader or error page
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading your journal...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-red-800 font-semibold mb-2">Error loading journal</h2>
          <p className="text-red-600">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        user={user}
        entries={entries}
        selectedEntryId={viewingEntry?.id}
        onSelectEntry={handleSelectEntry}
      />
      <main className="flex-1 overflow-hidden">
        {activeTab === 'journal' && (
          <div className="h-full bg-slate-50">
            <JournalEditor
              entry={null}
              onSave={handleSave}
              onCancel={() => {}}
              isSaving={isSaving}
            />
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
        )}
        {activeTab === 'insights' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-slate-900">Insights</h2>
            <p className="text-slate-600 mt-2">Coming soon...</p>
          </div>
        )}
        {activeTab === 'goals' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-slate-900">Goals</h2>
            <p className="text-slate-600 mt-2">Coming soon...</p>
          </div>
        )}
        {activeTab === 'people' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-slate-900">People</h2>
            <p className="text-slate-600 mt-2">Coming soon...</p>
          </div>
        )}
        {activeTab === 'users' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-slate-900">Users</h2>
            <p className="text-slate-600 mt-2">Coming soon...</p>
          </div>
        )}
      </main>
    </div>
  );
}