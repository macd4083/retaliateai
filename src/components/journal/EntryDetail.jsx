import React from 'react';
import { format } from 'date-fns';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Sparkles, Target, Users, Tag, Trash2 } from "lucide-react";

export default function EntryDetail({ entry, goals, people, onClose, onDelete }) {
  const relatedGoals = goals?.filter(g => entry.related_goals?.includes(g.id)) || [];
  const mentionedPeople = people?.filter(p => entry.mentioned_people?.includes(p.id)) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">
              {format(new Date(entry.created_date), 'EEEE, MMMM d, yyyy')}
            </p>
            {entry.title && (
              <h2 className="text-xl font-semibold text-slate-900 mt-1">{entry.title}</h2>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="w-5 h-5" />
          </Button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
          
          {entry.ai_feedback && (
            <div className="mt-6 p-4 bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border border-violet-100">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-violet-100 rounded-lg">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                </div>
                <span className="font-medium text-violet-900">AI Feedback</span>
              </div>
              <p className="text-violet-800 text-sm leading-relaxed">{entry.ai_feedback}</p>
            </div>
          )}
          
          {entry.ai_patterns_detected?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {entry.ai_patterns_detected.map((pattern, i) => (
                <span key={i} className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full border border-amber-200">
                  {pattern}
                </span>
              ))}
            </div>
          )}
          
          {relatedGoals.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">Related Goals</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {relatedGoals.map((goal) => (
                  <Badge key={goal.id} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    {goal.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {mentionedPeople.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">People Mentioned</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {mentionedPeople.map((person) => (
                  <Badge key={person.id} variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    {person.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {entry.tags?.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">Tags</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.tags.map((tag, i) => (
                  <span key={i} className="text-sm bg-slate-100 text-slate-600 px-3 py-1 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-slate-100 flex justify-end">
          <Button 
            variant="ghost" 
            onClick={() => onDelete(entry.id)}
            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Entry
          </Button>
        </div>
      </div>
    </div>
  );
}
