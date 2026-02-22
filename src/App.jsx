import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import JournalEditor from './components/journal/JournalEditor';
import EntryDetailModal from './components/journal/EntryDetailModal';
import Clarity from './pages/Clarity';
import Gratitude from './pages/Gratitude';
import Insights from './pages/Insights';
import Goals from './pages/Goals';
import Users from './pages/Users';
import { useAuth } from './lib/AuthContext';
import {
  useJournalEntries,
  useCreateJournalEntry,
  useUpdateJournalEntry,
  useDeleteJournalEntry,
} from './hooks';

export default function App() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Top-left logo ref (destination for the animation)
  const topLeftLogoRef = React.useRef(null);

  // Determine activeTab from URL
  const getTabFromPath = (path) => {
    const pathMap = {
      '/Journal': 'journal',
      '/Clarity': 'clarity',
      '/Gratitude': 'gratitude',
      '/Insights': 'insights',
      '/Goals': 'goals',
      '/People': 'people',
      '/Users': 'users',
    };
    return pathMap[path] || 'journal';
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath(location.pathname));
  const [viewingEntry, setViewingEntry] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [suggestedGoal, setSuggestedGoal] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Animation state
  const [animPhase, setAnimPhase] = useState('loading');
  const [showAnim, setShowAnim] = useState(false);

  const { data: entries = [], isLoading, error } = useJournalEntries(user?.id);
  const createEntry = useCreateJournalEntry(user?.id);
  const updateEntry = useUpdateJournalEntry();
  const deleteEntry = useDeleteJournalEntry();

  // Update activeTab when URL changes
  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  // Animation controller
  useEffect(() => {
    if (!isLoading || !showAnim) return;

    const fadeTimer = setTimeout(() => setAnimPhase('fadeOut'), 1500);
    const closeTimer = setTimeout(() => setAnimPhase('closing'), 1750);
    const doneTimer = setTimeout(() => {
      setShowAnim(false);
      sessionStorage.setItem('retaliateai_welcome_done', '1');
    }, 2750);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(closeTimer);
      clearTimeout(doneTimer);
    };
  }, [isLoading, showAnim]);

  // Check session on mount
  useEffect(() => {
    const already = sessionStorage.getItem('retaliateai_welcome_done') === '1';
    if (!already && isLoading) {
      setShowAnim(true);
    }
  }, [isLoading]);

  // Handle tab changes and update URL
  const handleTabChange = (newTab) => {
    const tabToPathMap = {
      journal: '/Journal',
      clarity: '/Clarity',
      gratitude: '/Gratitude',
      insights: '/Insights',
      goals: '/Goals',
      people: '/People',
      users: '/Users',
    };
    navigate(tabToPathMap[newTab] || '/Journal');
  };

  // When user clicks on an entry in the sidebar, show it in the modal
  const handleSelectEntry = (entry) => {
    setViewingEntry(entry);
    setSelectedEntryId(entry.id);
    setSuggestedGoal(null);
  };

  // Mutations/handlers
  const handleSave = async (entryData) => {
    setIsSaving(true);
    try {
      const result = await createEntry.mutateAsync(entryData);
      if (result?.entry) {
        setTimeout(() => {
          setViewingEntry({
            ...result.entry,
            follow_up_questions: result.followUpQuestions,
          });
          setSelectedEntryId(result.entry.id);
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

      const answersText =
        '\n\n--- Follow-up Reflections ---\n' + answers.join('\n\n');
      const updatedContent = currentEntry.content + answersText;

      let combinedEmbedding = null;

      if (currentEntry.embedding) {
        let currentEmbedding = currentEntry.embedding;
        if (typeof currentEmbedding === 'string') {
          try {
            currentEmbedding = JSON.parse(currentEmbedding);
          } catch (e) {
            console.warn(
              'Could not parse existing embedding, generating new one'
            );
            currentEmbedding = null;
          }
        }

        if (currentEmbedding && Array.isArray(currentEmbedding)) {
          const newAnswersResponse = await fetch('/api/generate-embedding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: answersText }),
          });

          if (newAnswersResponse.ok) {
            const { embedding: newAnswersEmbedding } =
              await newAnswersResponse.json();

            const originalWeight = currentEntry.content.length;
            const newWeight = answersText.length;
            const totalWeight = originalWeight + newWeight;

            combinedEmbedding = currentEmbedding.map(
              (val, i) =>
                (val * originalWeight + newAnswersEmbedding[i] * newWeight) /
                totalWeight
            );
          }
        }
      }

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

      let similarEntries = [];
      if (combinedEmbedding) {
        const similarResponse = await fetch('/api/search-similar-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            embedding: combinedEmbedding,
            limit: 10,
          }),
        });

        if (similarResponse.ok) {
          const { entries: similar } = await similarResponse.json();
          similarEntries = similar;
        }
      }

      let userProfile;
      try {
        const response = await fetch(`/api/user-profile?user_id=${user.id}`);
        const { data: profile } = await response.json();
        userProfile = profile?.summary_text || 'No profile yet.  This is a new user.';
      } catch (error) {
        userProfile = 'No profile yet.  This is a new user.';
      }

      const analysisResponse = await fetch('/api/analyze-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_entry: updatedContent,
          past_summaries: similarEntries.map((e) => e.summary).filter(Boolean),
          user_profile: userProfile,
        }),
      });

      if (!analysisResponse.ok) {
        throw new Error('Failed to analyze entry');
      }

      const analysis = await analysisResponse.json();

      const updateData = {
        content: updatedContent,
        summary: analysis.summary,
        insights: analysis.insights,
      };

      if (combinedEmbedding) {
        updateData.embedding = combinedEmbedding;
      }

      await updateEntry.mutateAsync({
        entryId: entryId,
        entryData: updateData,
      });

      setViewingEntry({
        ...currentEntry,
        content: updatedContent,
        summary: analysis.summary,
        insights: analysis.insights,
        follow_up_questions: null,
      });

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
        setSelectedEntryId(null);
        setSuggestedGoal(null);
      }
    } catch (error) {
      console.error('Failed to delete entry:', error);
      alert('Failed to delete entry. Please try again.');
    }
  };

  const handleEdit = (entry) => {
    setViewingEntry(null);
    setSelectedEntryId(null);
    setSuggestedGoal(null);
  };

  const handleAcceptGoal = async () => {
    if (!suggestedGoal || !user) {
      console.error('No suggested goal or user');
      return;
    }

    try {
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
      alert(`Goal "${goal.title}" has been added to your goals!`);
      setSuggestedGoal(null);
    } catch (error) {
      console.error('Failed to accept goal:', error);
      alert('Failed to create goal. Please try again.');
    }
  };

  const handleDismissGoal = () => {
    setSuggestedGoal(null);
  };

  // Calculate animation positions
  const getAnimationStyles = () => {
    if (!topLeftLogoRef.current) return {};
    
    const rect = topLeftLogoRef.current.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height / 2;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    return {
      targetX,
      targetY,
      translateX: targetX - centerX,
      translateY: targetY - centerY,
      scale: rect.width / 80
    };
  };

  const animStyles = getAnimationStyles();

  // LOADING STATE
  if (isLoading) {
    return (
      <>
        {/* App shell (always rendered so logo target exists) */}
        <div className="flex h-screen bg-slate-50 overflow-hidden">
          <div className="w-64 flex flex-col bg-white border-r border-slate-200">
            <div className="h-20 bg-white border-b border-slate-200 flex items-center px-4">
              <div className="flex items-center gap-3">
                <img
                  ref={topLeftLogoRef}
                  src="/inverselogo.png"
                  alt="Retaliate AI"
                  className="w-14 h-14 object-contain"
                  style={{ opacity: showAnim ? 0 : 1 }}
                />
                <span 
                  className="text-2xl font-blackletter text-black tracking-tight"
                  style={{ opacity: showAnim ? 0 : 1 }}
                >
                  Retaliate AI
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-hidden" />
          </div>
          <main className="flex-1 overflow-hidden" />
        </div>

        {/* Animation overlay (only first load per session) */}
        {showAnim && (
          <div
            className="fixed inset-0 z-[9999] bg-red-50 flex items-center justify-center overflow-hidden"
            style={{
              clipPath:
                animPhase === 'closing'
                  ? `circle(0% at ${animStyles.targetX || 100}px ${animStyles.targetY || 50}px)`
                  : 'circle(100%)',
              transition: animPhase === 'closing' ? 'clip-path 1000ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            }}
          >
            {/* Spinner + text */}
            <div
              className="text-center"
              style={{
                opacity: animPhase === 'loading' ? 1 : 0,
                transition: animPhase === 'fadeOut' ? 'opacity 250ms ease-out' : 'none',
              }}
            >
              <div className="relative mx-auto mb-6 h-20 w-20">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    borderWidth: 4,
                    borderStyle: 'solid',
                    borderColor: 'rgba(148,163,184,0.45)',
                    borderTopColor: 'rgba(220,38,38,0.85)',
                    animation: 'retaliate-spin 0.9s linear infinite',
                  }}
                />
                <img
                  src="/inverselogo.png"
                  alt="Retaliate AI"
                  className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 object-contain"
                  draggable="false"
                />
              </div>
              <p className="text-slate-700 font-medium text-lg">Loading your journal...</p>
            </div>

            {/* Flying logo */}
            <img
              src="/inverselogo.png"
              alt=""
              className="absolute object-contain pointer-events-none"
              style={{
                left: '50%',
                top: '50%',
                width: '80px',
                height: '80px',
                marginLeft: '-40px',
                marginTop: '-40px',
                opacity: animPhase === 'closing' ? 1 : 0,
                transform:
                  animPhase === 'closing'
                    ? `translate(${animStyles.translateX || 0}px, ${animStyles.translateY || 0}px) scale(${animStyles.scale || 0.7})`
                    : 'translate(0, 0) scale(1)',
                transition:
                  animPhase === 'closing'
                    ? 'transform 1000ms cubic-bezier(0.4, 0, 0.2, 1), opacity 100ms ease-in'
                    : 'none',
              }}
              draggable="false"
            />

            <style>{`
              @keyframes retaliate-spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}
      </>
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
      {/* Sidebar with Header */}
      <div className="w-64 flex flex-col bg-white border-r border-slate-200">
        <div className="h-20 bg-white border-b border-slate-200 flex items-center px-4">
          <div className="flex items-center gap-3">
            <img
              ref={topLeftLogoRef}
              src="/inverselogo.png"
              alt="Retaliate AI"
              className="w-14 h-14 object-contain"
            />
            <span className="text-2xl font-blackletter text-black tracking-tight">
              Retaliate AI
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <Sidebar
            activeTab={activeTab}
            onTabChange={handleTabChange}
            entries={entries}
            selectedEntryId={selectedEntryId}
            onSelectEntry={handleSelectEntry}
            user={user}
          />
        </div>
      </div>

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
          </div>
        )}

        {activeTab === 'clarity' && <Clarity />}
        {activeTab === 'gratitude' && <Gratitude />}
        {activeTab === 'insights' && <Insights />}
        {activeTab === 'goals' && <Goals />}

        {activeTab === 'people' && (
          <div className="p-8">
            <h1 className="text-2xl font-bold text-slate-900">People</h1>
            <p className="text-slate-600 mt-2">Track the important people in your life.</p>
          </div>
        )}

        {activeTab === 'users' && user?.role === 'admin' && <Users />}
      </main>

      {/* Entry Detail Modal */}
      {viewingEntry && (
        <EntryDetailModal
          entry={viewingEntry}
          onClose={() => {
            setViewingEntry(null);
            setSelectedEntryId(null);
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
  );
}