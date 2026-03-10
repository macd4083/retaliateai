import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useGoal, useUpdateGoal, useDeleteGoal } from '@/hooks/useGoals';
import { useGoalActions, useCreateGoalAction, useUpdateGoalAction, useCompleteGoalAction, useArchiveGoalAction, useDeleteGoalAction } from '@/hooks/useGoalActions';
import { ArrowLeft, Plus, CheckCircle, Archive, Trash2, MoreVertical, Pencil } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

export default function GoalDetail() {
  const { goalId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeView, setActiveView] = useState('active');
  const [showNewActionModal, setShowNewActionModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);

  const { data: goal, isLoading: goalLoading } = useGoal(goalId);
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  
  const statusFilter = activeView === 'achieved' ? 'achieved' : activeView;
  const { data: actions = [], isLoading: actionsLoading } = useGoalActions(goalId, statusFilter);

  const createAction = useCreateGoalAction(goalId);
  const updateAction = useUpdateGoalAction();
  const completeAction = useCompleteGoalAction();
  const archiveAction = useArchiveGoalAction();
  const deleteAction = useDeleteGoalAction();

  if (goalLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Goal not found</h2>
          <button
            onClick={() => navigate('/goals')}
            className="text-blue-600 hover:text-blue-700"
          >
            Back to Goals
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto p-8">
        {/* Header with Back Button */}
        <button
          onClick={() => navigate('/goals')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Back to Goals</span>
        </button>

        {/* Goal Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-2">
            <h1 className="text-3xl font-bold text-slate-900 flex-1">{goal.title}</h1>
            
            {/* 3-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0">
                  <MoreVertical className="w-5 h-5 text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditingGoal(true)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  if (confirm('Archive this goal? You can restore it later.')) {
                    updateGoal.mutate(
                      { goalId: goal.id, goalData: { status: 'archived' } },
                      { onSuccess: () => navigate('/goals') }
                    );
                  }
                }}>
                  <Archive className="w-4 h-4 mr-2" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => {
                    if (confirm('Delete this goal permanently? This cannot be undone.')) {
                      deleteGoal.mutate(goal.id, {
                        onSuccess: () => navigate('/goals')
                      });
                    }
                  }}
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {goal.description && (
            <p className="text-slate-600">{goal.description}</p>
          )}
        </div>

        {/* Actions Section */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900">Actions & Next Steps</h2>
          <button
            onClick={() => setShowNewActionModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Action
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

        {/* Actions List */}
        <div className="space-y-3">
          {actionsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            </div>
          ) : actions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <p className="text-slate-600 mb-4">
                {activeView === 'active' ? 'No active actions yet' : `No ${activeView} actions`}
              </p>
              {activeView === 'active' && (
                <button
                  onClick={() => setShowNewActionModal(true)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                >
                  Create First Action
                </button>
              )}
            </div>
          ) : (
            actions.map((action) => (
              <div
                key={action.id}
                className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 mb-1">{action.title}</h3>
                    {action.due_date && (
                      <p className="text-sm text-slate-500">
                        Due: {new Date(action.due_date).toLocaleDateString()}
                      </p>
                    )}
                    {action.ai_generated && (
                      <span className="inline-block mt-2 px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded">
                        AI Generated
                      </span>
                    )}
                  </div>

                  {/* Action Menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {action.status === 'active' && (
                        <DropdownMenuItem onClick={() => completeAction.mutate(action.id)}>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Mark as Achieved
                        </DropdownMenuItem>
                      )}
                      {action.status !== 'archived' && (
                        <DropdownMenuItem onClick={() => archiveAction.mutate(action.id)}>
                          <Archive className="w-4 h-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => deleteAction.mutate(action.id)}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))
          )}
        </div>

        {/* New Action Modal */}
        {showNewActionModal && (
          <NewActionModal
            onClose={() => setShowNewActionModal(false)}
            onCreate={(actionData) => {
              createAction.mutate(actionData, {
                onSuccess: () => setShowNewActionModal(false),
              });
            }}
            isLoading={createAction.isPending}
          />
        )}

        {/* Edit Goal Modal */}
        {editingGoal && (
          <EditGoalModal
            goal={goal}
            onClose={() => setEditingGoal(false)}
            onSave={(goalData) => {
              updateGoal.mutate(
                { goalId: goal.id, goalData },
                { onSuccess: () => setEditingGoal(false) }
              );
            }}
            isLoading={updateGoal.isPending}
          />
        )}
      </div>
    </div>
  );
}

// Modal for creating new action
function NewActionModal({ onClose, onCreate, isLoading }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    onCreate({
      title: title.trim(),
      due_date: dueDate || null,
      ai_generated: false,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-6">
        <h2 className="text-2xl font-bold mb-4">Create New Action</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Action Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Research gyms nearby, Set up LinkedIn..."
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Due Date (optional)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
              {isLoading ? 'Creating...' : 'Create Action'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal for editing goal
function EditGoalModal({ goal, onClose, onSave, isLoading }) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    
    onSave({
      title: title.trim(),
      description: description.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-6">
        <h2 className="text-2xl font-bold mb-4">Edit Goal</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Goal Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you looking to improve? e.g., Academics, Health, Career"
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
              placeholder="What specifically are you working on?"
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
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
} 