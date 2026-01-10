import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useGoals } from '@/hooks/useGoals';
import { Target, Plus, TrendingUp, Clock, AlertCircle, MoreVertical, Archive, CheckCircle2, Edit, Trash2, RotateCcw } from 'lucide-react';

export default function Goals() {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState('active');
  
  // Map 'achieved' to 'completed' for the database query
  const statusFilter = activeView === 'achieved' ? 'completed' : activeView;
  
  // Fetch goals from database based on active view
  const { data: goals = [], isLoading, error } = useGoals(user?.id, statusFilter);

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
            <p className="text-slate-600 mt-1">Track progress.  Take action.  Achieve results.</p>
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium transition-colors">
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
        <div className="grid gap-6">
          {goals. length === 0 ? (
            <div className="text-center py-12">
              <Target className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-700 mb-2">
                No {activeView} goals yet
              </h3>
              <p className="text-slate-500">
                {activeView === 'active' && "Create a goal to start tracking your progress"}
                {activeView === 'achieved' && "Complete a goal to see it here"}
                {activeView === 'archived' && "Archive a goal to see it here"}
              </p>
            </div>
          ) : (
            goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={() => console.log('Edit', goal. id)}
                onArchive={() => console.log('Archive', goal.id)}
                onAchieve={() => console.log('Mark as achieved', goal.id)}
                onDelete={() => console.log('Delete', goal.id)}
                onActivate={() => console.log('Activate', goal.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function GoalCard({ goal, onEdit, onArchive, onAchieve, onDelete, onActivate }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const momentumConfig = {
    accelerating: { color: 'text-green-600', bg: 'bg-green-50', icon: TrendingUp },
    steady: { color: 'text-blue-600', bg: 'bg-blue-50', icon:  Clock },
    stalled: { color: 'text-orange-600', bg: 'bg-orange-50', icon: AlertCircle },
  };

  const momentum = goal.momentum || 'steady';
  const config = momentumConfig[momentum] || momentumConfig.steady;
  const MomentumIcon = config.icon;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-md transition-shadow relative">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-slate-900 mb-1">{goal.title}</h3>
          {goal.description && (
            <p className="text-slate-600 text-sm whitespace-pre-wrap">{goal.description}</p>
          )}
          {goal.category && (
            <span className="inline-block mt-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
              {goal.category}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {goal.status === 'active' && (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${config.bg}`}>
              <MomentumIcon className={`w-4 h-4 ${config. color}`} />
              <span className={`text-sm font-medium ${config.color} capitalize`}>{momentum}</span>
            </div>
          )}
          
          {/* Dropdown Menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-slate-600" />
            </button>

            {menuOpen && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setMenuOpen(false)}
                />
                
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20">
                  <button
                    onClick={() => {
                      onEdit();
                      setMenuOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Edit Goal
                  </button>

                  {goal.status === 'active' && (
                    <>
                      <button
                        onClick={() => {
                          onAchieve();
                          setMenuOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-green-700 hover:bg-green-50 flex items-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Mark as Achieved
                      </button>
                      <button
                        onClick={() => {
                          onArchive();
                          setMenuOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <Archive className="w-4 h-4" />
                        Archive
                      </button>
                    </>
                  )}

                  {goal. status === 'archived' && (
                    <button
                      onClick={() => {
                        onActivate();
                        setMenuOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Activate
                    </button>
                  )}

                  <div className="border-t border-slate-200 my-1" />
                  
                  <button
                    onClick={() => {
                      onDelete();
                      setMenuOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="text-sm text-slate-500">
        Created {new Date(goal.created_at).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        })}
        {goal.completed_at && (
          <span className="ml-2">
            • Completed {new Date(goal.completed_at).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              year: 'numeric' 
            })}
          </span>
        )}
        {goal.target_date && goal.status === 'active' && (
          <span className="ml-2">
            • Target: {new Date(goal.target_date).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              year:  'numeric' 
            })}
          </span>
        )}
      </div>
    </div>
  );
}