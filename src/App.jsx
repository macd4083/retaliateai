import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import JournalEditor from './components/journal/JournalEditor';
import EntryDetailModal from './components/journal/EntryDetailModal';
import Clarity from './pages/Clarity';
import Gratitude from './pages/Gratitude';
import Insights from './pages/Insights';
import Goals from './pages/Goals';
import GoalDetail from './pages/GoalDetail';
import Users from './pages/Users';
import Reflection from './pages/Reflection';
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

  const topLeftLogoRef = useRef(null);

  const getTabFromPath = (path) => {
    if (path.startsWith('/goals')) return 'goals';
    if (path.startsWith('/insights')) return 'insights';
    if (path.startsWith('/clarity')) return 'clarity';
    if (path.startsWith('/gratitude')) return 'gratitude';
    if (path.startsWith('/users')) return 'users';
    if (path.startsWith('/people')) return 'people';
    if (path.startsWith('/reflection')) return 'reflection';
    return 'journal';
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath(location.pathname));
  const [viewingEntry, setViewingEntry] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [suggestedGoal, setSuggestedGoal] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Animation state
  const [animationPhase, setAnimationPhase] = useState('spinner'); // 'spinner' | 'fade' | 'fly' | 'done'
  const [targetPosition, setTargetPosition] = useState({ x: 100, y: 50 });

  const { data: entries = [], isLoading, error } = useJournalEntries(user?.id);
  const createEntry = useCreateJournalEntry(user?.id);
  const updateEntry = useUpdateJournalEntry();
  const deleteEntry = useDeleteJournalEntry();

  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  // Handle animation on first session load
  useEffect(() => {
    if (!isLoading) return;

    const alreadyShown = sessionStorage.getItem('retaliateai_welcome_done');
    if (alreadyShown === '1') {
      setAnimationPhase('done');
      return;
    }

    // Measure target logo position
    const measureLogo = () => {
      if (topLeftLogoRef.current) {
        const rect = topLeftLogoRef.current.getBoundingClientRect();
        setTargetPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
    };

    setTimeout(measureLogo, 100);

    // Animation timeline
    const timer1 = setTimeout(() => setAnimationPhase('fade'), 1500);
    const timer2 = setTimeout(() => setAnimationPhase('fly'), 1750);
    const timer3 = setTimeout(() => {
      setAnimationPhase('done');
      sessionStorage.setItem('retaliateai_welcome_done', '1');
    }, 2750);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [isLoading]);

  const handleTabChange = (newTab) => {
    const tabToPathMap = {
      journal: '/journal',
      clarity: '/clarity',
      gratitude: '/gratitude',
      insights: '/insights',
      goals: '/goals',
      people: '/people',
      users: '/users',
      reflection: '/reflection',
    };
    navigate(tabToPathMap[newTab] || '/journal');
  };

  const handleSelectEntry = (entry) => {
    setViewingEntry(entry);
    setSelectedEntryId(entry.id);
    setSuggestedGoal(null);
  };

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

  // Render reflection page OUTSIDE sidebar layout (full-screen, no sidebar)
  if (location.pathname.startsWith('/reflection')) {
    return (
      <Routes>
        <Route path="/reflection" element={<Reflection />} />
      </Routes>
    );
  }

  // RENDER LOADING WITH ANIMATION
  if (isLoading && animationPhase !== 'done') {
    const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 960;
    const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 540;
    const translateX = targetPosition.x - centerX;
    const translateY = targetPosition.y - centerY;
    const scale = 0.7;

    return (
      <>
        {/* Background app shell */}
        <div className="flex h-screen bg-slate-50 overflow-hidden">
          <div className="w-64 flex flex-col bg-white border-r border-slate-200">
            <div className="h-20 bg-white border-b border-slate-200 flex items-center px-4">
              <div className="flex items-center gap-3">
                <img
                  ref={topLeftLogoRef}
                  src="/inverselogo.png"
                  alt="Retaliate AI"
                  className="w-14 h-14 object-contain opacity-0"
                />
                <span className="text-2xl font-blackletter text-black tracking-tight opacity-0">
                  Retaliate AI
                </span>
              </div>
            </div>
            <div className="flex-1" />
          </div>
          <main className="flex-1" />
        </div>

        {/* Animated red overlay */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: '#fef2f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            clipPath: animationPhase === 'fly' 
              ? `circle(0% at ${targetPosition.x}px ${targetPosition.y}px)` 
              : 'circle(100%)',
            transition: animationPhase === 'fly' ? 'clip-path 1s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          }}
        >
          {/* Spinner + Text (fades out) */}
          <div
            style={{
              textAlign: 'center',
              opacity: animationPhase === 'spinner' ? 1 : 0,
              transition: animationPhase === 'fade' ? 'opacity 0.25s ease-out' : 'none',
            }}
          >
            <div style={{ position: 'relative', width: '96px', height: '96px', margin: '0 auto 24px' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  border: '5px solid rgba(148,163,184,0.45)',
                  borderTopColor: 'rgba(220,38,38,0.85)',
                  animation: 'spin-animation 0.9s linear infinite',
                }}
              />
              {/* White circle background */}
              <div
                style={{
                  position: 'absolute',
                  inset: '5px',
                  borderRadius: '50%',
                  backgroundColor: 'white',
                }}
              />
              <img
                src="/inverselogo.png"
                alt=""
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: '56px',
                  height: '56px',
                  transform: 'translate(-50%, -50%)',
                  objectFit: 'contain',
                  zIndex: 1,
                }}
              />
            </div>
            <p style={{ color: '#334155', fontWeight: 500, fontSize: '18px' }}>
              Loading your journal...
            </p>
          </div>

          {/* Flying logo */}
          <img
            src="/inverselogo.png"
            alt=""
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: '80px',
              height: '80px',
              marginLeft: '-40px',
              marginTop: '-40px',
              objectFit: 'contain',
              pointerEvents: 'none',
              opacity: animationPhase === 'fly' ? 1 : 0,
              transform: animationPhase === 'fly'
                ? `translate(${translateX}px, ${translateY}px) scale(${scale})`
                : 'translate(0, 0) scale(1)',
              transition: animationPhase === 'fly'
                ? 'transform 1s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.1s ease-in'
                : 'none',
            }}
          />
        </div>

        <style>{`
          @keyframes spin-animation {
            to { transform: rotate(360deg); }
          }
        `}</style>
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

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route
            path="/journal"
            element={
              <div className="h-full bg-slate-50">
                <JournalEditor
                  entry={null}
                  onSave={handleSave}
                  onCancel={() => {}}
                  isSaving={isSaving}
                />
              </div>
            }
          />
          <Route path="/clarity" element={<Clarity />} />
          <Route path="/gratitude" element={<Gratitude />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/goals/:goalId" element={<GoalDetail />} />
          <Route
            path="/people"
            element={
              <div className="p-8">
                <h1 className="text-2xl font-bold text-slate-900">People</h1>
                <p className="text-slate-600 mt-2">Track the important people in your life.</p>
              </div>
            }
          />
          {user?.role === 'admin' && <Route path="/users" element={<Users />} />}
          <Route path="/" element={<Navigate to="/journal" replace />} />
        </Routes>
      </main>

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