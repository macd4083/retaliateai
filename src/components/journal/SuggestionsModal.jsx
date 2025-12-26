import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, CheckCircle, Circle, Target, Calendar, CheckSquare, Sparkles, ThumbsUp, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function SuggestionsModal({ feedback, suggestions, onClose, onAccept }) {
  const [selectedTodos, setSelectedTodos] = useState(new Set());
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [selectedGoals, setSelectedGoals] = useState(new Set());

  const toggleTodo = (index) => {
    const newSet = new Set(selectedTodos);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedTodos(newSet);
  };

  const toggleEvent = (index) => {
    const newSet = new Set(selectedEvents);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedEvents(newSet);
  };

  const toggleGoal = (index) => {
    const newSet = new Set(selectedGoals);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedGoals(newSet);
  };

  const handleAcceptAll = () => {
    onAccept({
      todos: suggestions.todos?.filter((_, i) => selectedTodos.has(i)) || [],
      events: suggestions.events?.filter((_, i) => selectedEvents.has(i)) || [],
      goals: suggestions.goals?.filter((_, i) => selectedGoals.has(i)) || [],
    });
    onClose();
  };

  const hasSuggestions = 
    (suggestions.todos?.length > 0) || 
    (suggestions.events?.length > 0) || 
    (suggestions.goals?.length > 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-200 bg-gradient-to-br from-violet-50 to-purple-50">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-600 rounded-xl">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">AI Insights & Suggestions</h2>
                <p className="text-sm text-slate-600 mt-0.5">Your personalized feedback</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* AI Feedback Section */}
          <div className="space-y-4">
            {feedback.doing_well && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <ThumbsUp className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-green-900 mb-1">You're Doing Great!</h3>
                    <p className="text-sm text-green-800 leading-relaxed">{feedback.doing_well}</p>
                  </div>
                </div>
              </div>
            )}

            {feedback.improvements_seen && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-blue-900 mb-1">Progress Detected</h3>
                    <p className="text-sm text-blue-800 leading-relaxed">{feedback.improvements_seen}</p>
                  </div>
                </div>
              </div>
            )}

            {feedback.areas_to_improve && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Target className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-amber-900 mb-1">Areas to Focus On</h3>
                    <p className="text-sm text-amber-800 leading-relaxed mb-2">{feedback.areas_to_improve}</p>
                    {feedback.how_to_improve && (
                      <div className="mt-2 pl-3 border-l-2 border-amber-300">
                        <p className="text-sm text-amber-700 italic">{feedback.how_to_improve}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions Section */}
          {hasSuggestions && (
            <div className="pt-4 border-t border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-600" />
                Suggested Actions
              </h3>
              <p className="text-sm text-slate-600 mb-4">Select which suggestions you'd like to add:</p>

              <div className="space-y-4">
                {/* Suggested Todos */}
                {suggestions.todos?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckSquare className="w-4 h-4 text-slate-600" />
                      <h4 className="text-sm font-semibold text-slate-700">Todos</h4>
                    </div>
                    <div className="space-y-2">
                      {suggestions.todos.map((todo, index) => (
                        <button
                          key={index}
                          onClick={() => toggleTodo(index)}
                          className="w-full flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-left"
                        >
                          {selectedTodos.has(index) ? (
                            <CheckCircle className="w-5 h-5 text-violet-600 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-300 mt-0.5 flex-shrink-0" />
                          )}
                          <span className="text-sm text-slate-700">{todo}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Calendar Events */}
                {suggestions.events?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-slate-600" />
                      <h4 className="text-sm font-semibold text-slate-700">Calendar Reminders</h4>
                    </div>
                    <div className="space-y-2">
                      {suggestions.events.map((event, index) => (
                        <button
                          key={index}
                          onClick={() => toggleEvent(index)}
                          className="w-full flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-left"
                        >
                          {selectedEvents.has(index) ? (
                            <CheckCircle className="w-5 h-5 text-violet-600 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-300 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1">
                            <p className="text-sm text-slate-700 font-medium">{event.title}</p>
                            {event.description && (
                              <p className="text-xs text-slate-500 mt-1">{event.description}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Goals */}
                {suggestions.goals?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4 text-slate-600" />
                      <h4 className="text-sm font-semibold text-slate-700">Goals</h4>
                    </div>
                    <div className="space-y-2">
                      {suggestions.goals.map((goal, index) => (
                        <button
                          key={index}
                          onClick={() => toggleGoal(index)}
                          className="w-full flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-left"
                        >
                          {selectedGoals.has(index) ? (
                            <CheckCircle className="w-5 h-5 text-violet-600 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-300 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1">
                            <p className="text-sm text-slate-700 font-medium">{goal.title}</p>
                            {goal.description && (
                              <p className="text-xs text-slate-500 mt-1">{goal.description}</p>
                            )}
                            {goal.category && (
                              <span className="inline-block mt-1 text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                                {goal.category}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Skip for Now
          </Button>
          {hasSuggestions && (
            <Button
              onClick={handleAcceptAll}
              className="bg-violet-600 hover:bg-violet-700"
              disabled={selectedTodos.size === 0 && selectedEvents.size === 0 && selectedGoals.size === 0}
            >
              Add Selected ({selectedTodos.size + selectedEvents.size + selectedGoals.size})
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
