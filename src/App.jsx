import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import JournalEditor from './components/journal/JournalEditor';
import EntryDetailModal from './components/journal/EntryDetailModal';
import Insights from './pages/Insights';
import Goals from './pages/Goals';
import Users from './pages/Users';
import { useAuth } from './lib/AuthContext';
import { useJournalEntries, useCreateJournalEntry, useUpdateJournalEntry, useDeleteJournalEntry } from './hooks';

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
  const [suggestedGoal, setSuggestedGoal] = useState(null);
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
    setSuggestedGoal(null); // Clear any previous goal suggestions
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
          // Set suggested goal if AI provided one
          if (result.suggestedGoal) {
            setSuggestedGoal(result.suggestedGoal);
          }
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

      // Generate embedding for the updated content
      let combinedEmbedding = null;
      
      if (currentEntry.embedding) {
        // Check if embedding is an array or needs to be parsed
        let currentEmbedding = currentEntry. embedding;
        if (typeof currentEmbedding === 'string') {
          try {
            currentEmbedding = JSON.parse(currentEmbedding);
          } catch (e) {
            console.warn('Could not parse existing embedding, generating new one');
            currentEmbedding = null;
          }
        }

        if (currentEmbedding && Array.isArray(currentEmbedding)) {
          // Generate embedding for ONLY the new answers (more efficient)
          const newAnswersResponse = await fetch('/api/generate-embedding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: answersText }),
          });

          if (newAnswersResponse. ok) {
            const { embedding:  newAnswersEmbedding } = await newAnswersResponse.json();

            // Combine embeddings (weighted by content length)
            const originalWeight = currentEntry.content.length;
            const newWeight = answersText.length;
            const totalWeight = originalWeight + newWeight;

            combinedEmbedding = currentEmbedding.map((val, i) => 
              (val * originalWeight + newAnswersEmbedding[i] * newWeight) / totalWeight
            );
          }
        }
      }
      
      // If we couldn't combine embeddings, generate one for the full content
      if (!combinedEmbedding) {
        const embeddingResponse = await fetch('/api/generate-embedding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: updatedContent }),
        });

        if (embeddingResponse.ok) {
          const { embedding } = await embeddingResponse.json();
          combinedEmbedding = embedding;
        }
      }

      // Search for similar entries using the combined embedding
      let similarEntries = [];
      if (combinedEmbedding) {
        const similarResponse = await fetch('/api/search-similar-entries', {
          method:  'POST',
          headers:  { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user. id,
            embedding: combinedEmbedding,
            limit: 10,
          }),
        });

        if (similarResponse.ok) {
          const { entries: similar } = await similarResponse.json();
          similarEntries = similar;
        }
      }

      // Get user profile
      let userProfile;
      try {
        const response = await fetch(`/api/user-profile?user_id=${user.id}`);
        const { data: profile } = await response. json();
        userProfile = profile?. summary_text || 'No profile yet.  This is a new user.';
      } catch (error) {
        userProfile = 'No profile yet.  This is a new user.';
      }

      // Analyze the updated entry
      const analysisResponse = await fetch('/api/analyze-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:  JSON.stringify({
          new_entry:  updatedContent,
          past_summaries: similarEntries. map(e => e.summary).filter(Boolean),
          user_profile: userProfile,
        }),
      });

      if (! analysisResponse.ok) {
        throw new Error('Failed to analyze entry');
      }

      const analysis = await analysisResponse.json();

      // Prepare update data
      const updateData = {
        content: updatedContent,
        summary: analysis.summary,
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
        follow_up_questions: null, // Clear follow-up questions after answering
      });

      // Check if new goal suggestion from follow-up analysis
      if (analysis.suggested_goal) {
        setSuggestedGoal(analysis.suggested_goal);
      }
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
        setSuggestedGoal(null);
      }
    } catch (error) {
      console.error('Failed to delete entry:', error);
      alert('Failed to delete entry. Please try again.');
    }
  };

  const handleEdit = (entry) => {
    // Close the modal and open the entry in the editor
    setViewingEntry(null);
    setSuggestedGoal(null);
    // You could add editing functionality here if needed
    // For now, we'll just close the modal
  };

  const handleAcceptGoal = async () => {
    if (!suggestedGoal || !user) {
      console.error('No suggested goal or user');
      return;
    }

    try {
      // Call API to create the goal in database
      const response = await fetch('/api/create-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          title: suggestedGoal.title,
          description: suggestedGoal.description,
          why_it_matters: suggestedGoal.why_it_matters,
          category: suggestedGoal.category,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create goal');
      }

      const { goal } = await response.json();
      
      // Show success message
      alert(`Goal "${goal.title}" has been added to your goals!`);
      
      // Clear the suggestion
      setSuggestedGoal(null);
      
      // Optionally navigate to goals page
      // navigate('/Goals');
    } catch (error) {
      console.error('Failed to accept goal:', error);
      alert('Failed to create goal. Please try again.');
    }
  };

  const handleDismissGoal = () => {
    setSuggestedGoal(null);
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
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        entries={entries}
        onSelectEntry={handleSelectEntry}
        user={user}
      />

      {/* Main Content */}
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
                onClose={() => {
                  setViewingEntry(null);
                  setSuggestedGoal(null);
                }}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSubmitFollowUp={handleSubmitFollowUp}
                suggestedGoal={suggestedGoal}
                onAcceptGoal={handleAcceptGoal}
                onDismissGoal={handleDismissGoal}
              />
            )}
          </div>
        )}
        {activeTab === 'insights' && <Insights />}
        {activeTab === 'goals' && <Goals />}
        {activeTab === 'people' && (
          <div className="p-8">
            <h1 className="text-2xl font-bold text-slate-900">People</h1>
            <p className="text-slate-600 mt-2">Track the important people in your life. </p>
          </div>
        )}
        {activeTab === 'users' && user?. role === 'admin' && <Users />}
      </main>
    </div>
  );
}