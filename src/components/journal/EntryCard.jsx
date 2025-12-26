import React from 'react';
import { format } from 'date-fns';
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Sparkles, ChevronRight } from "lucide-react";

export default function EntryCard({ entry, onClick }) {
  const preview = entry.content.length > 150 
    ? entry.content.substring(0, 150) + '...' 
    : entry.content;

  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-md transition-all duration-200 cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-slate-400 font-medium tracking-wide uppercase">
            {format(new Date(entry.created_date), 'EEEE, MMM d')}
          </p>
          {entry.title && (
            <h3 className="text-lg font-semibold text-slate-900 mt-1">{entry.title}</h3>
          )}
        </div>
      </div>
      
      <p className="text-slate-600 text-sm leading-relaxed mb-4">{preview}</p>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {entry.ai_feedback && (
            <div className="flex items-center gap-1 text-xs text-violet-600 bg-violet-50 px-2 py-1 rounded-full">
              <Sparkles className="w-3 h-3" />
              AI Insight
            </div>
          )}
          {entry.tags?.length > 0 && (
            <div className="flex gap-1">
              {entry.tags.slice(0, 2).map((tag, i) => (
                <span key={i} className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                  {tag}
                </span>
              ))}
              {entry.tags.length > 2 && (
                <span className="text-xs text-slate-400">+{entry.tags.length - 2}</span>
              )}
            </div>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
    </div>
  );
}
