import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from '@/hooks/useGoals';
import { Target, Plus, ChevronRight } from 'lucide-react';

export default function Goals() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState('active');
  const [showNewGoalModal, setShowNewGoalModal] = useState(false);
  
  // Map 'achieved' to 'completed' for the database query
  const statusFilter = activeView === 'achieved' ? 'completed' : activeView;
  
  // Fetch goals from database based on active view
  const { data: goals = [], isLoading, error } = useGoals(user?.id, statusFilter);
  const createGoal = useCreateGoal(user?.id);

  const handleCardClick = (goalId) => {
    navigate(`/goals/${goalId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading goals...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-red-800 font-semibold mb-2">Error loading goals</h2>
          <p className="text-red-600">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <Target className="w-8 h-8 text-blue-600" />
              Goals
            </h1>
            <p className="text-slate-600 mt-1">Your life areas and commitments</p>
          </div>
          <button 
            onClick={() => setShowNewGoalModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Goal
          </button>
        </div>

        {/* View Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-200">
          {[
            { id: 'active', label: 'Active' },
            { id: 'achieved', label: 'Achieved' },
            { id: 'archived', label: 'Archived' },
          ].map((view) => (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id)}
              className={`px-4 py-2 font-medium transition-colors ${
                activeView === view.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>

        {/* Goals Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {goals.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <Target className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">
                {activeView === 'active' ? 'No active goals yet' : `No ${activeView} goals`}
              </h3>
              <p className="text-slate-500 mb-4">
                {activeView === 'active' ? 'Create your first goal to get started' : ''}
              </p>
              {activeView === 'active' && (
                <button
                  onClick={() => setShowNewGoalModal(true)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                >
                  Create Goal
                </button>
              )}
            </div>
          ) : (
            goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => handleCardClick(goal.id)}
                className="bg-white rounded-xl border-2 border-slate-200 p-6 hover:border-blue-500 hover:shadow-lg transition-all text-left group"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                    {goal.title}
                  </h3>
                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                </div>
                
                {goal.description && (
                  <p className="text-sm text-slate-600 line-clamp-2 mb-3">
                    {goal.description}
                  </p>
                )}

                {goal.category && (
                  <span className="inline-block px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                    {goal.category}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* New Goal Modal */}
        {showNewGoalModal && (
          <NewGoalModal
            onClose={() => setShowNewGoalModal(false)}
            onCreate={(goalData) => {
              createGoal.mutate(goalData, {
                onSuccess: (newGoal) => {
                  setShowNewGoalModal(false);
                  navigate(`/goals/${newGoal.id}`);
                },
              });
            }}
            isLoading={createGoal.isPending}
          />
        )}
      </div>
    </div>
  );
}

// Simple modal for creating new goal
function NewGoalModal({ onClose, onCreate, isLoading }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    
    onCreate({
      title: title.trim(),
      description: description.trim() || null,
      status: 'active',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-6">
        <h2 className="text-2xl font-bold mb-4">Create New Goal</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Goal Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Health & Fitness, Career Growth..."
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this goal represent?"
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50"
              disabled={isLoading || !title.trim()}
            >
              {isLoading ? 'Creating...' : 'Create Goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}