import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, MoreHorizontal, MessageSquare } from "lucide-react";
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function PersonCard({ person, onDelete }) {
  const initials = person.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white font-semibold">
          {initials}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">{person.name}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={() => onDelete(person.id)}
                  className="text-rose-600"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {person.relationship && (
            <Badge variant="outline" className="mt-1 text-xs">
              {person.relationship}
            </Badge>
          )}
          
          {person.notes && (
            <p className="text-sm text-slate-600 mt-2">{person.notes}</p>
          )}
          
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
            {person.mention_count > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {person.mention_count} mention{person.mention_count > 1 ? 's' : ''}
              </span>
            )}
            {person.last_mentioned && (
              <span>Last: {format(new Date(person.last_mentioned), 'MMM d')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
