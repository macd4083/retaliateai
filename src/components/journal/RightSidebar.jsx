import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Target, Plus, CheckCircle, Circle, Trash2, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import CalendarWidget from './CalendarWidget';

export default function RightSidebar() {
  const queryClient = useQueryClient();
  const [newTodo, setNewTodo] = useState('');
  const [newHabit, setNewHabit] = useState('');

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Goal.filter({ status: 'paused', created_by: user.email }, '-created_date');
    },
  });

  const { data: todos = [] } = useQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Todo.filter({ created_by: user.email }, '-created_date', 20);
    },
  });

  const { data: googleConnectionStatus } = useQuery({
    queryKey: ['google-connection'],
    queryFn: async () => {
      try {
        const response = await base44.functions.invoke('syncGoogleTasks');
        return { connected: true };
      } catch (e) {
        return { connected: false };
      }
    },
    retry: false,
    staleTime: 60000,
  });

  const syncGoogleTasksMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('syncGoogleTasks');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });

  const { data: habits = [] } = useQuery({
    queryKey: ['habits'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Habit.filter({ is_active: true, created_by: user.email });
    },
  });

  const createTodoMutation = useMutation({
    mutationFn: (title) => base44.entities.Todo.create({ title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      setNewTodo('');
    },
  });

  const toggleTodoMutation = useMutation({
    mutationFn: ({ id, completed }) => 
      base44.entities.Todo.update(id, { 
        completed: !completed,
        completed_date: !completed ? new Date().toISOString().split('T')[0] : null
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const deleteTodoMutation = useMutation({
    mutationFn: (id) => base44.entities.Todo.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const createHabitMutation = useMutation({
    mutationFn: (title) => base44.entities.Habit.create({ title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      setNewHabit('');
    },
  });

  const toggleHabitMutation = useMutation({
    mutationFn: (habit) => {
      const today = new Date().toISOString().split('T')[0];
      const dates = habit.completed_dates || [];
      const newDates = dates.includes(today)
        ? dates.filter(d => d !== today)
        : [...dates, today];
      return base44.entities.Habit.update(habit.id, { completed_dates: newDates });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });

  const deleteHabitMutation = useMutation({
    mutationFn: (id) => base44.entities.Habit.update(id, { is_active: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });

  const today = new Date().toISOString().split('T')[0];
  const incompleteTodos = todos.filter(t => !t.completed);

  return (
    <div className="space-y-6">
      <CalendarWidget />
      
      {/* Paused Goals */}
      {goals.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-slate-500" />
            <h3 className="font-semibold text-slate-900 text-sm">Paused Goals</h3>
          </div>
          <div className="space-y-2">
            {goals.slice(0, 5).map((goal) => (
              <div key={goal.id} className="text-sm text-slate-500 flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
                <span className="line-clamp-2">{goal.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Todos */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-900 text-sm">Todos</h3>
          {googleConnectionStatus?.connected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => syncGoogleTasksMutation.mutate()}
              disabled={syncGoogleTasksMutation.isPending}
              className="h-7 px-2"
              title="Sync with Google Tasks"
            >
              <RefreshCw className={`w-3 h-3 ${syncGoogleTasksMutation.isPending ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
        <div className="space-y-2 mb-3">
          {incompleteTodos.map((todo) => (
            <div key={todo.id} className="flex items-center gap-2 group">
              <Checkbox
                checked={todo.completed}
                onCheckedChange={() => toggleTodoMutation.mutate({ id: todo.id, completed: todo.completed })}
              />
              <span className="text-sm text-slate-700 flex-1">{todo.title}</span>
              <button
                onClick={() => deleteTodoMutation.mutate(todo.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-slate-400 hover:text-red-500" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add todo..."
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newTodo.trim() && createTodoMutation.mutate(newTodo)}
            className="text-sm h-8"
          />
          <Button
            size="sm"
            onClick={() => newTodo.trim() && createTodoMutation.mutate(newTodo)}
            className="h-8 px-2"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Habits */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900 text-sm mb-3">Habits</h3>
        <div className="space-y-2 mb-3">
          {habits.map((habit) => {
            const completedToday = habit.completed_dates?.includes(today);
            return (
              <div key={habit.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => toggleHabitMutation.mutate(habit)}
                  className="flex-shrink-0"
                >
                  {completedToday ? (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300 hover:text-slate-400" />
                  )}
                </button>
                <span className={`text-sm flex-1 ${completedToday ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  {habit.title}
                </span>
                <button
                  onClick={() => deleteHabitMutation.mutate(habit.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-slate-400 hover:text-red-500" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add habit..."
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newHabit.trim() && createHabitMutation.mutate(newHabit)}
            className="text-sm h-8"
          />
          <Button
            size="sm"
            onClick={() => newHabit.trim() && createHabitMutation.mutate(newHabit)}
            className="h-8 px-2"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
