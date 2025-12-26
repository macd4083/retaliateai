import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import GoalCard from '@/components/goals/GoalCard';
import { Loader2, Target, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const categories = [
  { value: 'health', label: 'Health & Fitness' },
  { value: 'career', label: 'Career & Work' },
  { value: 'relationships', label: 'Relationships' },
  { value: 'personal_growth', label: 'Personal Growth' },
  { value: 'financial', label: 'Financial' },
  { value: 'creative', label: 'Creative' },
  { value: 'other', label: 'Other' },
];

export default function Goals() {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [newGoal, setNewGoal] = useState({ title: '', description: '', category: '', priority: 'medium' });
  const [editingGoal, setEditingGoal] = useState(null);
  const queryClient = useQueryClient();

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Goal.filter({ created_by: user.email }, '-created_date');
    },
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Goal.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setShowForm(false);
      setNewGoal({ title: '', description: '', category: '', priority: 'medium' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Goal.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Goal.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  const filteredGoals = goals.filter(g => {
    if (activeTab === 'active') return g.status === 'active';
    if (activeTab === 'achieved') return g.status === 'achieved';
    if (activeTab === 'paused') return g.status === 'paused';
    return true;
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newGoal.title.trim()) return;
    
    if (editingGoal) {
      updateMutation.mutate({
        id: editingGoal.id,
        data: newGoal
      });
      setEditingGoal(null);
      setShowForm(false);
      setNewGoal({ title: '', description: '', category: '', priority: 'medium' });
    } else {
      createMutation.mutate({
        ...newGoal,
        status: 'active',
        mention_count: 0,
      });
    }
  };

  const handleEdit = (goal) => {
    setEditingGoal(goal);
    setNewGoal({
      title: goal.title,
      description: goal.description || '',
      category: goal.category || '',
      priority: goal.priority || 'medium'
    });
    setShowForm(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-xl">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Goals</h1>
              <p className="text-slate-500 text-sm">Track what matters to you</p>
            </div>
          </div>
          
          <Button
            onClick={() => {
              setShowForm(!showForm);
              if (showForm) {
                setEditingGoal(null);
                setNewGoal({ title: '', description: '', category: '', priority: 'medium' });
              }
            }}
            className="bg-slate-900 hover:bg-slate-800 rounded-xl"
          >
            {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {showForm ? 'Cancel' : 'Add Goal'}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 space-y-4">
            <Input
              placeholder="What do you want to achieve?"
              value={newGoal.title}
              onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })}
              className="text-lg font-medium border-0 px-0 focus-visible:ring-0"
            />
            
            <Textarea
              placeholder="Add more details (optional)"
              value={newGoal.description}
              onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
              className="border-0 px-0 focus-visible:ring-0 resize-none"
            />
            
            <div className="flex gap-4">
              <Select
                value={newGoal.category}
                onValueChange={(value) => setNewGoal({ ...newGoal, category: value })}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select
                value={newGoal.priority}
                onValueChange={(value) => setNewGoal({ ...newGoal, priority: value })}
              >
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High Priority</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex justify-end pt-2">
              <Button 
                type="submit" 
                disabled={!newGoal.title.trim()}
                className="bg-blue-600 hover:bg-blue-700 rounded-xl px-6"
              >
                {editingGoal ? 'Update Goal' : 'Create Goal'}
              </Button>
            </div>
          </form>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="bg-white border border-slate-200 p-1 rounded-xl">
            <TabsTrigger value="active" className="rounded-lg data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Active ({goals.filter(g => g.status === 'active').length})
            </TabsTrigger>
            <TabsTrigger value="achieved" className="rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              Achieved ({goals.filter(g => g.status === 'achieved').length})
            </TabsTrigger>
            <TabsTrigger value="paused" className="rounded-lg data-[state=active]:bg-slate-500 data-[state=active]:text-white">
              Paused ({goals.filter(g => g.status === 'paused').length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-4">
          {filteredGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onUpdate={(id, data) => updateMutation.mutate({ id, data })}
              onDelete={(id) => deleteMutation.mutate(id)}
              onEdit={handleEdit}
            />
          ))}
          
          {filteredGoals.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              {activeTab === 'active' ? 'No active goals. Add one to get started!' : `No ${activeTab} goals`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
