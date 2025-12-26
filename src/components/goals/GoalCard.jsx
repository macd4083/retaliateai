import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, CheckCircle2, Pause, MoreHorizontal, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const categoryColors = {
  health: 'bg-emerald-100 text-emerald-700',
  career: 'bg-blue-100 text-blue-700',
  relationships: 'bg-rose-100 text-rose-700',
  personal_growth: 'bg-violet-100 text-violet-700',
  financial: 'bg-amber-100 text-amber-700',
  creative: 'bg-pink-100 text-pink-700',
  other: 'bg-slate-100 text-slate-700',
};

const statusIcons = {
  active: Target,
  achieved: CheckCircle2,
  paused: Pause,
};

export default function GoalCard({ goal, onUpdate, onDelete, onEdit }) {
  const StatusIcon = statusIcons[goal.status] || Target;
  
  return (
    <div className={`bg-white rounded-2xl border p-5 transition-all ${
      goal.status === 'achieved' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${
            goal.status === 'achieved' ? 'bg-emerald-100' : 'bg-slate-100'
          }`}>
            <StatusIcon className={`w-5 h-5 ${
              goal.status === 'achieved' ? 'text-emerald-600' : 'text-slate-600'
            }`} />
          </div>
          <div>
            <h3 className={`font-semibold ${
              goal.status === 'achieved' ? 'text-emerald-800 line-through' : 'text-slate-900'
            }`}>
              {goal.title}
            </h3>
            {goal.category && (
              <Badge className={`${categoryColors[goal.category]} border-0 mt-1 text-xs`}>
                {goal.category.replace('_', ' ')}
              </Badge>
            )}
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(goal)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            {goal.status !== 'achieved' && (
              <DropdownMenuItem onClick={() => onUpdate(goal.id, { status: 'achieved' })}>
                Mark as Achieved
              </DropdownMenuItem>
            )}
            {goal.status !== 'paused' && goal.status !== 'achieved' && (
              <DropdownMenuItem onClick={() => onUpdate(goal.id, { status: 'paused' })}>
                Pause Goal
              </DropdownMenuItem>
            )}
            {goal.status === 'paused' && (
              <DropdownMenuItem onClick={() => onUpdate(goal.id, { status: 'active' })}>
                Resume Goal
              </DropdownMenuItem>
            )}
            <DropdownMenuItem 
              onClick={() => onDelete(goal.id)}
              className="text-rose-600"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {goal.description && (
        <p className="text-sm text-slate-600 mb-3">{goal.description}</p>
      )}
      
      {goal.mention_count > 0 && (
        <p className="text-xs text-slate-400">
          Referenced {goal.mention_count} time{goal.mention_count > 1 ? 's' : ''} in your journal
        </p>
      )}
    </div>
  );
}
