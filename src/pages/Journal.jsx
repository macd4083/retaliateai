import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import JournalEditor from '@/components/journal/JournalEditor';
import EntryCard from '@/components/journal/EntryCard';
import EntryDetail from '@/components/journal/EntryDetail';
import StatsBar from '@/components/journal/StatsBar';
import RightSidebar from '@/components/journal/RightSidebar';
import TrackedGoals from '@/components/journal/TrackedGoals';
import SuggestionsModal from '@/components/journal/SuggestionsModal';
import { Loader2, BookOpen, Search, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { startOfWeek, isAfter, differenceInDays, parseISO } from 'date-fns';

export default function Journal() {
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [progressNotes, setProgressNotes] = useState({});
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [currentSuggestions, setCurrentSuggestions] = useState(null);
  const queryClient = useQueryClient();

  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['entries'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.JournalEntry.filter({ created_by: user.email }, '-created_date', 100);
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Goal.filter({ created_by: user.email }, '-created_date');
    },
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
  });

  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Person.filter({ created_by: user.email });
    },
  });

  const { data: insights = [] } = useQuery({
    queryKey: ['insights'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.AIInsight.filter({ is_active: true, created_by: user.email }, '-created_date', 20);
    },
  });

  const stats = useMemo(() => {
    if (!entries.length) return { totalEntries: 0, streak: 0, activeGoals: 0 };
    
    // Calculate streak
    let streak = 0;
    const sortedDates = [...new Set(entries.map(e => 
      e.created_date.split('T')[0]
    ))].sort().reverse();
    
    const today = new Date().toISOString().split('T')[0];
    if (sortedDates[0] === today || differenceInDays(new Date(today), new Date(sortedDates[0])) <= 1) {
      streak = 1;
      for (let i = 1; i < sortedDates.length; i++) {
        if (differenceInDays(new Date(sortedDates[i-1]), new Date(sortedDates[i])) === 1) {
          streak++;
        } else break;
      }
    }
    
    return {
      totalEntries: entries.length,
      streak,
      activeGoals: goals.filter(g => g.status === 'active').length,
    };
  }, [entries, goals]);

  const generateProgressSummary = useMemo(() => {
    if (entries.length === 0) return "Start journaling to see your personalized progress summary here.";
    if (entries.length < 3) return "Keep writing! After a few more entries, I'll have enough context to provide meaningful insights about your patterns and progress.";
    
    const activeGoalsCount = goals.filter(g => g.status === 'active').length;
    const goalNote = activeGoalsCount > 0 
      ? `You're actively working on ${activeGoalsCount} goal${activeGoalsCount > 1 ? 's' : ''}.`
      : "You haven't set any goals yet.";
    
    return `${goalNote} You've written ${entries.length} entries total. Keep reflecting to unlock deeper insights!`;
  }, [entries, goals]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      return base44.entities.JournalEntry.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.JournalEntry.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      setSelectedEntry(null);
    },
  });

  const deactivateGoalMutation = useMutation({
    mutationFn: (id) => base44.entities.Goal.update(id, { status: 'paused' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const today = new Date().toISOString().split('T')[0];
  const trackedGoals = goals.filter(g => {
    if (g.status !== 'active') return false;
    const progressNotes = g.progress_notes || [];
    const hasNotedToday = progressNotes.some(note => note.date === today);
    return !hasNotedToday;
  });

  const handleSaveEntry = async (data) => {
    setIsProcessing(true);
    
    // Combine main entry with goal progress notes
    let fullContent = data.content;
    const trackedGoalProgress = [];
    
    trackedGoals.forEach(goal => {
      if (progressNotes[goal.id]?.trim()) {
        fullContent += `\n\n[Progress on "${goal.title}"]: ${progressNotes[goal.id]}`;
        trackedGoalProgress.push({
          goal_id: goal.id,
          note: progressNotes[goal.id],
          date: new Date().toISOString().split('T')[0]
        });
      }
    });
    
    // Get recent entries for context
    const recentEntries = entries.slice(0, 5).map(e => e.content.substring(0, 300)).join('\n---\n');
    
    // Enhanced AI analysis with comprehensive feedback and suggestions
    const analysisPrompt = `Analyze this journal entry and provide comprehensive feedback and actionable suggestions.

Current Entry: "${fullContent}"

Recent Entries for Context:
${recentEntries}

User's Active Goals: ${goals.filter(g => g.status === 'active').map(g => g.title).join(', ')}
People the user tracks: ${people.map(p => p.name).join(', ')}

Provide a comprehensive analysis with:

1. FEEDBACK (be genuine, supportive, and specific):
   - doing_well: What they're doing great (highlight positive patterns, growth, self-awareness)
   - improvements_seen: Progress or positive changes noticed from recent entries
   - areas_to_improve: Constructive areas to focus on (be kind but honest)
   - how_to_improve: Specific, actionable steps to address the areas above

2. PATTERNS: Brief phrases describing patterns noticed

3. TAGS: Themes in this entry

4. RELATED GOALS: Goal titles that clearly relate to this entry

5. MENTIONED PEOPLE: Names explicitly mentioned

6. SUGGESTIONS (ONLY suggest if genuinely helpful based on the entry content):
   - todos: Specific actionable tasks mentioned or implied in the entry (e.g., "call mom", "book dentist appointment", "review project proposal")
   - events: Time-sensitive calendar reminders mentioned (e.g., meetings, appointments, deadlines)
   - goals: New meaningful goals worth tracking long-term if they mention aspirations not already in active goals

Be selective with suggestions - only include them if they would genuinely help track progress or take action on what was written.`;

    const analysisResult = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          feedback: {
            type: "object",
            properties: {
              doing_well: { type: "string" },
              improvements_seen: { type: "string" },
              areas_to_improve: { type: "string" },
              how_to_improve: { type: "string" }
            }
          },
          patterns: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          related_goal_titles: { type: "array", items: { type: "string" } },
          mentioned_names: { type: "array", items: { type: "string" } },
          suggestions: {
            type: "object",
            properties: {
              todos: { type: "array", items: { type: "string" } },
              events: { 
                type: "array", 
                items: { 
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" }
                  }
                } 
              },
              goals: { 
                type: "array", 
                items: { 
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    category: { type: "string" }
                  }
                } 
              }
            }
          }
        }
      }
    });

    // Match goal titles to IDs
    const relatedGoalIds = goals
      .filter(g => analysisResult.related_goal_titles?.some(
        title => g.title.toLowerCase().includes(title.toLowerCase()) || 
                 title.toLowerCase().includes(g.title.toLowerCase())
      ))
      .map(g => g.id);

    // Match people names to IDs
    const mentionedPeopleIds = people
      .filter(p => analysisResult.mentioned_names?.some(
        name => p.name.toLowerCase().includes(name.toLowerCase()) ||
                name.toLowerCase().includes(p.name.toLowerCase())
      ))
      .map(p => p.id);

    // Show suggestions modal first
    const feedbackSummary = `${analysisResult.feedback.doing_well || ''} ${analysisResult.feedback.improvements_seen || ''} ${analysisResult.feedback.areas_to_improve || ''}`.trim();
    
    setCurrentSuggestions({
      feedback: analysisResult.feedback,
      suggestions: analysisResult.suggestions,
      entryData: {
        ...data,
        content: fullContent,
        ai_feedback: feedbackSummary,
        ai_patterns_detected: analysisResult.patterns,
        tags: analysisResult.tags,
        related_goals: relatedGoalIds,
        mentioned_people: mentionedPeopleIds,
      },
      trackedGoalProgress
    });
    
    setShowSuggestions(true);
    setIsProcessing(false);
  };

  const handleAcceptSuggestions = async (selectedSuggestions) => {
    if (!currentSuggestions) return;
    
    // Create the journal entry
    await createMutation.mutateAsync(currentSuggestions.entryData);
    
    // Update goal progress notes
    for (const { goal_id, note, date } of currentSuggestions.trackedGoalProgress) {
      const goal = goals.find(g => g.id === goal_id);
      if (goal) {
        const existingNotes = goal.progress_notes || [];
        await base44.entities.Goal.update(goal_id, {
          progress_notes: [...existingNotes, { date, note }]
        });
      }
    }

    // Refetch goals to update the tracked goals list
    await queryClient.invalidateQueries({ queryKey: ['goals'] });

    // Clear progress notes
    setProgressNotes({});

    // Update mention counts for goals and people
    const relatedGoalIds = currentSuggestions.entryData.related_goals || [];
    const mentionedPeopleIds = currentSuggestions.entryData.mentioned_people || [];
    for (const goalId of relatedGoalIds) {
      const goal = goals.find(g => g.id === goalId);
      if (goal) {
        await base44.entities.Goal.update(goalId, {
          mention_count: (goal.mention_count || 0) + 1
        });
      }
    }

    for (const personId of mentionedPeopleIds) {
      const person = people.find(p => p.id === personId);
      if (person) {
        await base44.entities.Person.update(personId, {
          mention_count: (person.mention_count || 0) + 1,
          last_mentioned: new Date().toISOString().split('T')[0]
        });
      }
    }
    
    // Create selected todos
    for (const todoTitle of selectedSuggestions.todos) {
      await base44.entities.Todo.create({ title: todoTitle });
    }
    
    // Create selected goals
    for (const goal of selectedSuggestions.goals) {
      const goalData = {
        title: goal.title || 'Untitled Goal',
        category: goal.category || 'other',
        status: 'active'
      };
      if (goal.description) {
        goalData.description = goal.description;
      }
      await base44.entities.Goal.create(goalData);
    }
    
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['goals'] });
    setCurrentSuggestions(null);

    // Check if we should generate new insights (every 5 entries)
    if ((entries.length + 1) % 5 === 0) {
      const recentEntries = entries.slice(0, 10);
      const insightPrompt = `Based on these recent journal entries, identify one meaningful pattern, habit, or area for improvement:

Entries:
${recentEntries.map(e => `- ${e.content.substring(0, 200)}`).join('\n')}

Current active goals: ${goals.filter(g => g.status === 'active').map(g => g.title).join(', ')}

Provide ONE insight that is specific, actionable, and genuinely helpful. Be honest but kind.`;

      const insightResult = await base44.integrations.Core.InvokeLLM({
        prompt: insightPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["pattern", "habit", "mistake", "progress", "recommendation"] },
            title: { type: "string" },
            description: { type: "string" },
            confidence: { type: "number" }
          }
        }
      });

      await base44.entities.AIInsight.create({
        ...insightResult,
        is_active: true,
        first_detected: new Date().toISOString().split('T')[0]
      });

      queryClient.invalidateQueries({ queryKey: ['insights'] });
    }

    queryClient.invalidateQueries({ queryKey: ['goals'] });
    queryClient.invalidateQueries({ queryKey: ['people'] });
    setIsProcessing(false);
  };

  const filteredEntries = entries.filter(entry => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      entry.content.toLowerCase().includes(q) ||
      entry.title?.toLowerCase().includes(q) ||
      entry.tags?.some(t => t.toLowerCase().includes(q))
    );
  });

  const pastEntriesSidebar = (
    <div className="mt-6 pt-6 border-t border-slate-100 flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 mb-3">
        <History className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">Past Entries</h3>
      </div>
      
      <div className="px-2 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 bg-slate-50 border-slate-200 rounded-lg text-xs h-8"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2">
        {entriesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        ) : filteredEntries.length > 0 ? (
          <div className="space-y-2">
            {filteredEntries.slice(0, 10).map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedEntry(entry)}
                className="w-full text-left p-3 rounded-lg hover:bg-slate-50 transition-colors group"
              >
                <p className="text-xs font-medium text-slate-700 truncate group-hover:text-slate-900">
                  {entry.title || 'Untitled'}
                </p>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {entry.content.substring(0, 50)}...
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400 text-xs">
            {searchQuery ? 'No matches' : 'No entries yet'}
          </div>
        )}
      </div>
    </div>
  );

  // Pass sidebar content to Layout via a custom attribute
  React.useEffect(() => {
    const layoutElement = document.querySelector('[data-layout-root]');
    if (layoutElement) {
      layoutElement.setAttribute('data-sidebar-content', 'journal-entries');
    }
  }, []);

  return (
    <>
      {typeof window !== 'undefined' && ReactDOM.createPortal(
        pastEntriesSidebar,
        document.getElementById('sidebar-content-slot') || document.body
      )}
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-900 rounded-xl">
                <BookOpen className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Journal</h1>
                <p className="text-slate-500 text-sm">Write, reflect, grow</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200">
              <span className="text-2xl">🔥</span>
              <div>
                <p className="text-xs text-slate-500">Streak</p>
                <p className="text-lg font-bold text-slate-900">{stats.streak} days</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2 space-y-6">
              <TrackedGoals 
                goals={trackedGoals}
                progressNotes={progressNotes}
                onProgressChange={(id, note) => setProgressNotes(prev => ({ ...prev, [id]: note }))}
                onDeactivate={(id) => deactivateGoalMutation.mutate(id)}
              />
              <JournalEditor onSave={handleSaveEntry} isProcessing={isProcessing} />
            </div>

            <div className="lg:col-span-1">
              <RightSidebar />
            </div>
          </div>
        </div>

        {selectedEntry && (
          <EntryDetail
            entry={selectedEntry}
            goals={goals}
            people={people}
            onClose={() => setSelectedEntry(null)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        )}

        {showSuggestions && currentSuggestions && (
          <SuggestionsModal
            feedback={currentSuggestions.feedback}
            suggestions={currentSuggestions.suggestions}
            onClose={() => {
              setShowSuggestions(false);
              handleAcceptSuggestions({ todos: [], events: [], goals: [] });
            }}
            onAccept={handleAcceptSuggestions}
          />
        )}
        </div>
    </>
  );
}