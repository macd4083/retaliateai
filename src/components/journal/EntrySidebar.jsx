import React from 'react';
import { format } from 'date-fns';

export default function EntrySidebar({
  entries = [],
  selectedEntryId,
  onSelectEntry,
  searchQuery,
  onSearchChange,
}) {
  // Filter entries by title or date
  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery) return true;
    const query = searchQuery.trim().toLowerCase();
    const title = entry.title ? entry.title.toLowerCase() : '';
    const dateStr = entry.created_at
      ? format(new Date(entry.created_at), 'MMM d, yyyy').toLowerCase()
      : '';
    return title.includes(query) || dateStr.includes(query);
  });

  return (
    <aside className="w-80 h-full bg-slate-50 border-r border-slate-200 flex flex-col">
      {/* Search bar */}
      <div className="p-4 bg-white border-b border-slate-200">
        <input
          type="text"
          placeholder="Search by title or date..."
          className="w-full px-3 py-2 border border-slate-300 rounded-md"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* List of entries */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredEntries.length === 0 ? (
          <div className="text-center text-slate-500 pt-8">
            {searchQuery ? 'No matching entries found.' : 'No journal entries yet.'}
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <button
              key={entry.id}
              className={`block w-full text-left mb-2 px-3 py-2 rounded-lg transition border ${
                selectedEntryId === entry.id
                  ? "bg-blue-100 border-blue-300"
                  : "bg-white border-slate-200 hover:bg-slate-100"
              }`}
              onClick={() => onSelectEntry(entry)}
            >
              <div className="font-semibold text-sm truncate">
                {entry.title || "Untitled Entry"}
              </div>
              <div className="text-xs text-slate-500">
                {entry.created_at
                  ? format(new Date(entry.created_at), 'MMM d, yyyy')
                  : ''}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}