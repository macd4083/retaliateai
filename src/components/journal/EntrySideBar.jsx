import React from 'react';
import { Search } from 'lucide-react';
import { format } from 'date-fns';

export default function EntrySidebar({ entries, selectedEntryId, onSelectEntry, searchQuery, onSearchChange }) {
  const filteredEntries = entries.filter((entry) => {
    if (! searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const dateStr = format(new Date(entry.created_at), 'MMM d, yyyy').toLowerCase();
    return (
      entry.title?. toLowerCase().includes(query) ||
      dateStr.includes(query)
    );
  });

  return (
    <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 bg-white border-b border-slate-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by title or date..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Entry List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">
              {searchQuery ? 'No matching entries' : 'No entries yet'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelectEntry(entry)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                selectedEntryId === entry.id
                  ?  'bg-blue-100 border border-blue-300'
                  : 'bg-white border border-slate-200 hover: border-slate-300 hover:shadow-sm'
              }`}
            >
              <h3 className="font-medium text-slate-900 text-sm truncate mb-1">
                {entry. title || 'Untitled Entry'}
              </h3>
              <p className="text-xs text-slate-500">
                {format(new Date(entry.created_at), 'MMM d, yyyy')}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}