import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from '@/hooks/useGoals';
import { Target, Plus, MoreVertical, Archive, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

export default function Goals() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showNewGoalModal, setShowNewGoalModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  
  // Fetch active goals
  const { data: activeGoals = [], isLoading, error } = useGoals(user?.id, 'active');
  
  // Fetch archived goals
  const { data: archivedGoals = [] } = useGoals(user?.id, 'archived');
  
  const createGoal = useCreateGoal(user?.id);
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const handleCardClick = (goalId) => {
    navigate(`/goals/${goalId}`);
  };

  const handleArchive = async (e, goalId) => {
    e.stopPropagation(); // Prevent card click
    if (confirm('Archive this goal? You can restore it later.')) {
      try {
        await updateGoal.mutateAsync({
          goalId,
          goalData: { status: 'archived' },
        });
      } catch (error) {
        console.error('Error archiving goal:', error);
        alert('Failed to archive goal. Please try again.');
      }
    }
  };

  const handleDelete = async (e, goalId) => {
    e.stopPropagation(); // Prevent card click
    if (confirm('Are you sure you want to delete this goal? This cannot be undone.')) {
      try {
        await deleteGoal.mutateAsync(goalId);
      } catch (error) {
        console.error('Error deleting goal:', error);
        alert('Failed to delete goal. Please try again.');
      }
    }
  };

  const handleRestore = async (e, goalId) => {
    e.stopPropagation();
    try {
      await updateGoal.mutateAsync({
        goalId,
        goalData: { status: 'active' },
      });
    } catch (error) {
      console.error('Error restoring goal:', error);
      alert('Failed to restore goal. Please try again.');
    }
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
      <div className="max-w-4xl mx-auto p-8">
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
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            New Goal
          </button>
        </div>

        {/* Active Goals List */}
        <div className="space-y-3">
          {activeGoals.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-slate-300">
              <Target className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">
                No goals yet
              </h3>
              <p className="text-slate-500 mb-6">
                Create your first goal to get started
              </p>
              <button
                onClick={() => setShowNewGoalModal(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Create Goal
              </button>
            </div>
          ) : (
            activeGoals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => handleCardClick(goal.id)}
                className="w-full bg-white rounded-lg border-2 border-slate-200 p-5 hover:border-blue-500 hover:shadow-md transition-all text-left group flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors mb-1 truncate">
                    {goal.title}
                  </h3>
                  {goal.description && (
                    <p className="text-sm text-slate-600 line-clamp-1">
                      {goal.description}
                    </p>
                  )}
                </div>

                {/* 3-dot menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="ml-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-5 h-5 text-slate-400" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => handleArchive(e, goal.id)}>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={(e) => handleDelete(e, goal.id)}
                      className="text-red-600 focus:text-red-600 focus:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </button>
            ))
          )}
        </div>

        {/* Show Archived Toggle */}
        {archivedGoals.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-200">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors flex items-center gap-2"
            >
              <Archive className="w-4 h-4" />
              {showArchived ? 'Hide' : 'Show'} Archived ({archivedGoals.length})
            </button>

            {/* Archived Goals */}
            {showArchived && (
              <div className="mt-4 space-y-3">
                {archivedGoals.map((goal) => (
                  <button
                    key={goal.id}
                    onClick={() => handleCardClick(goal.id)}
                    className="w-full bg-slate-50 rounded-lg border-2 border-slate-200 p-5 hover:border-slate-400 hover:shadow-sm transition-all text-left group flex items-center justify-between opacity-60 hover:opacity-100"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold text-slate-700 mb-1 truncate">
                        {goal.title}
                      </h3>
                      {goal.description && (
                        <p className="text-sm text-slate-500 line-clamp-1">
                          {goal.description}
                        </p>
                      )}
                    </div>

                    {/* Archived menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="ml-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-5 h-5 text-slate-400" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => handleRestore(e, goal.id)}>
                          <Archive className="w-4 h-4 mr-2" />
                          Restore
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={(e) => handleDelete(e, goal.id)}
                          className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
              placeholder="e.g., Academics, Boxing, Photography..."
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