import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PersonCard from '@/components/people/PersonCard';
import { Loader2, Users, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function People() {
  const [showForm, setShowForm] = useState(false);
  const [newPerson, setNewPerson] = useState({ name: '', relationship: '', notes: '' });
  const queryClient = useQueryClient();

  const { data: people = [], isLoading } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Person.filter({ created_by: user.email }, '-mention_count', 100);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Person.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] });
      setShowForm(false);
      setNewPerson({ name: '', relationship: '', notes: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Person.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['people'] }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newPerson.name.trim()) return;
    createMutation.mutate({
      ...newPerson,
      mention_count: 0,
    });
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
            <div className="p-2.5 bg-purple-600 rounded-xl">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">People</h1>
              <p className="text-slate-500 text-sm">Keep track of important people in your life</p>
            </div>
          </div>
          
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-slate-900 hover:bg-slate-800 rounded-xl"
          >
            {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {showForm ? 'Cancel' : 'Add Person'}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 space-y-4">
            <Input
              placeholder="Person's name"
              value={newPerson.name}
              onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
              className="text-lg font-medium border-0 px-0 focus-visible:ring-0"
            />
            
            <Input
              placeholder="Relationship (e.g., friend, colleague, family)"
              value={newPerson.relationship}
              onChange={(e) => setNewPerson({ ...newPerson, relationship: e.target.value })}
              className="border-0 px-0 focus-visible:ring-0"
            />
            
            <Textarea
              placeholder="Notes about this person (optional)"
              value={newPerson.notes}
              onChange={(e) => setNewPerson({ ...newPerson, notes: e.target.value })}
              className="border-0 px-0 focus-visible:ring-0 resize-none"
            />
            
            <div className="flex justify-end pt-2">
              <Button 
                type="submit" 
                disabled={!newPerson.name.trim()}
                className="bg-purple-600 hover:bg-purple-700 rounded-xl px-6"
              >
                Add Person
              </Button>
            </div>
          </form>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {people.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
          
          {people.length === 0 && (
            <div className="col-span-2 text-center py-12 text-slate-400">
              No people added yet. The AI will also automatically detect people mentioned in your entries.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}