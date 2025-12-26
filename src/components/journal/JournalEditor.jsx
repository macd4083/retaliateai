import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Send, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

const DEFAULT_PROMPTS = [
  "What did you do good today?",
  "What could you improve?",
  "Brain Dump",
  "How do you feel today?"
];

export default function JournalEditor({ onSave, isProcessing }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [customPrompts, setCustomPrompts] = useState([]);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [newCustomPrompt, setNewCustomPrompt] = useState('');
  const [todaysDate, setTodaysDate] = useState(format(new Date(), 'EEEE, MMMM d, yyyy'));

  useEffect(() => {
    const interval = setInterval(() => {
      setTodaysDate(format(new Date(), 'EEEE, MMMM d, yyyy'));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('customJournalPrompts');
    if (stored) {
      setCustomPrompts(JSON.parse(stored));
    }
  }, []);

  useEffect(() => {
    if (!title) {
      setTitle(todaysDate);
    }
  }, [todaysDate]);

  const handleSubmit = () => {
    if (!content.trim()) return;
    onSave({ title: title.trim() || undefined, content });
    setTitle(todaysDate);
    setContent('');
  };

  const handleAddCustomPrompt = () => {
    if (!newCustomPrompt.trim()) return;
    const updated = [...customPrompts, newCustomPrompt.trim()];
    setCustomPrompts(updated);
    localStorage.setItem('customJournalPrompts', JSON.stringify(updated));
    setTitle(newCustomPrompt.trim());
    setNewCustomPrompt('');
    setShowCustomInput(false);
  };

  const handleDeletePrompt = (prompt) => {
    const updated = customPrompts.filter(p => p !== prompt);
    setCustomPrompts(updated);
    localStorage.setItem('customJournalPrompts', JSON.stringify(updated));
    if (title === prompt) {
      setTitle(todaysDate);
    }
  };

  const handleDeleteDefaultPrompt = (prompt) => {
    if (title === prompt) {
      setTitle(todaysDate);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 space-y-4">
        <Select value={title} onValueChange={setTitle}>
          <SelectTrigger className="border-0 text-lg font-medium focus:ring-0 px-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={todaysDate}>{todaysDate}</SelectItem>
            
            {DEFAULT_PROMPTS.map((prompt) => (
              <div key={prompt} className="flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 cursor-pointer group">
                <SelectItem value={prompt} className="flex-1 border-0">{prompt}</SelectItem>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDefaultPrompt(prompt);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded"
                >
                  <X className="w-3 h-3 text-red-500" />
                </button>
              </div>
            ))}
            
            {customPrompts.map((prompt) => (
              <div key={prompt} className="flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 cursor-pointer group">
                <SelectItem value={prompt} className="flex-1 border-0">{prompt}</SelectItem>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePrompt(prompt);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded"
                >
                  <X className="w-3 h-3 text-red-500" />
                </button>
              </div>
            ))}
            
            {showCustomInput ? (
              <div className="px-2 py-2 flex gap-2">
                <Input
                  placeholder="Custom prompt..."
                  value={newCustomPrompt}
                  onChange={(e) => setNewCustomPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCustomPrompt()}
                  className="h-8 text-sm"
                  autoFocus
                />
                <Button size="sm" onClick={handleAddCustomPrompt} className="h-8 px-2">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowCustomInput(true)}
                className="w-full flex items-center gap-2 px-2 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                <Plus className="w-4 h-4" />
                Add custom prompt
              </button>
            )}
          </SelectContent>
        </Select>
        
        <Textarea
          placeholder="What's on your mind today? Write freely..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[200px] border-0 resize-none text-slate-700 placeholder:text-slate-300 focus-visible:ring-0 px-0 text-base leading-relaxed"
        />
      </div>
      
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!content.trim() || isProcessing}
          className="bg-slate-900 hover:bg-slate-800 rounded-xl px-6"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              <Sparkles className="w-4 h-4 mr-2" />
              Analyzing...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Save Entry
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
