import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from '@/hooks/useGoals';
import { Target, Plus, MoreVertical, Archive, Trash2, GripVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function Goals() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showNewGoalModal, setShowNewGoalModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeId, setActiveId] = useState(null);
  
  // Fetch active goals
  const { data: activeGoals = [], isLoading, error } = useGoals(user?.id, 'active');
  
  // Fetch archived goals
  const { data: archivedGoals = [] } = useGoals(user?.id, 'archived');
  
  const createGoal = useCreateGoal(user?.id);
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  // Local state for ordering
  const [orderedGoals, setOrderedGoals] = useState([]);

  // Initialize ordered goals when data loads
  useEffect(() => {
    if (activeGoals.length > 0) {
      // Sort by display_order if it exists, otherwise by created_at
      const sorted = [...activeGoals].sort((a, b) => {
        if (a.display_order !== undefined && b.display_order !== undefined) {
          return a.display_order - b.display_order;
        }
        return new Date(a.created_at) - new Date(b.created_at);
      });
      setOrderedGoals(sorted);
    }
  }, [activeGoals]);

  // Drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = orderedGoals.findIndex((goal) => goal.id === active.id);
    const newIndex = orderedGoals.findIndex((goal) => goal.id === over.id);

    const newOrder = arrayMove(orderedGoals, oldIndex, newIndex);
    setOrderedGoals(newOrder);

    // Save the new order to the database
    try {
      // Update display_order for all affected goals
      const updates = newOrder.map((goal, index) => ({
        goalId: goal.id,
        goalData: { display_order: index },
      }));

      // Execute updates (you might want to batch these in a real app)
      for (const update of updates) {
        await updateGoal.mutateAsync(update);
      }
    } catch (error) {
      console.error('Error saving goal order:', error);
      // Revert on error
      setOrderedGoals(orderedGoals);
    }
  };

  const handleCardClick = (goalId) => {
    navigate(`/goals/${goalId}`);
  };

  const handleArchive = async (e, goalId) => {
    e.stopPropagation();
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
    e.stopPropagation();
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

  const activeGoal = activeId ? orderedGoals.find((goal) => goal.id === activeId) : null;

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

        {/* Active Goals List with Drag & Drop */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedGoals.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {orderedGoals.length === 0 ? (
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
                orderedGoals.map((goal) => (
                  <SortableGoalCard
                    key={goal.id}
                    goal={goal}
                    onCardClick={handleCardClick}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                    isDragging={activeId === goal.id}
                  />
                ))
              )}
            </div>
          </SortableContext>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeGoal ? (
              <GoalCard
                goal={activeGoal}
                onCardClick={() => {}}
                onArchive={() => {}}
                onDelete={() => {}}
                isDragging={true}
                isOverlay={true}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

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
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onCardClick={handleCardClick}
                    onArchive={handleRestore}
                    onDelete={handleDelete}
                    isArchived={true}
                  />
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

// Sortable wrapper for drag & drop
function SortableGoalCard({ goal, onCardClick, onArchive, onDelete, isDragging }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: goal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <GoalCard
        goal={goal}
        onCardClick={onCardClick}
        onArchive={onArchive}
        onDelete={onDelete}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

// Goal card component
function GoalCard({ goal, onCardClick, onArchive, onDelete, isArchived = false, isDragging = false, isOverlay = false, dragHandleProps = {} }) {
  return (
    <button
      onClick={() => !isDragging && onCardClick(goal.id)}
      className={`w-full bg-white rounded-lg border-2 p-5 text-left group flex items-center gap-3 transition-all ${
        isArchived
          ? 'bg-slate-50 border-slate-200 opacity-60 hover:opacity-100 hover:border-slate-400 hover:shadow-sm'
          : isDragging || isOverlay
          ? 'border-blue-500 shadow-2xl cursor-grabbing'
          : 'border-slate-200 hover:border-blue-500 hover:shadow-md cursor-pointer'
      }`}
    >
      {/* Drag Handle */}
      {!isArchived && (
        <div
          {...dragHandleProps}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-5 h-5 text-slate-400" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className={`text-xl font-bold mb-1 truncate transition-colors ${
          isArchived 
            ? 'text-slate-700' 
            : 'text-slate-900 group-hover:text-blue-600'
        }`}>
          {goal.title}
        </h3>
        {goal.description && (
          <p className={`text-sm line-clamp-1 ${
            isArchived ? 'text-slate-500' : 'text-slate-600'
          }`}>
            {goal.description}
          </p>
        )}
      </div>

      {/* 3-dot menu */}
      {!isOverlay && (
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
            <DropdownMenuItem onClick={(e) => onArchive(e, goal.id)}>
              <Archive className="w-4 h-4 mr-2" />
              {isArchived ? 'Restore' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={(e) => onDelete(e, goal.id)}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </button>
  );
}

// Modal component (unchanged)
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