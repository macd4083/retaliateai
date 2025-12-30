import React, { useState } from 'react';
// ...other imports...
import { format } from 'date-fns';

// You may need to lift your useJournalEntries, etc. here (or pass them as props)

export default function Sidebar({ activeTab, onTabChange, user, entries = [], selectedEntryId, onSelectEntry, searchQuery, onSearchChange }) {
  const isAdmin = user?.role === 'admin';
  const [localSearch, setLocalSearch] = useState('');
  const filteredEntries = entries.filter((entry) => {
    if (!localSearch) return true;
    const query = localSearch.trim().toLowerCase();
    const title = entry.title ? entry.title.toLowerCase() : '';
    const dateStr = entry.created_at ? format(new Date(entry.created_at), 'MMM d, yyyy').toLowerCase() : '';
    return title.includes(query) || dateStr.includes(query);
  });

  // ...tabs array & navigation map above...

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-full">
      <div className="p-4 space-y-2">
        {/* navigation buttons (journal, insights, etc), mapped as before */}
      </div>

      {activeTab === 'journal' && (
        <div className="px-4 pb-4">
          <input
            type="text"
            placeholder="Search by title or date..."
            className="w-full px-3 py-2 border border-slate-300 rounded-md mb-2"
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
          />
          <div className="overflow-y-auto max-h-[60vh]">
            {filteredEntries.length === 0 ? (
              <div className="text-slate-400 py-8 text-center">
                {localSearch ? 'No matching entries found.' : 'No journal entries yet.'}
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
                    {entry.created_at ? format(new Date(entry.created_at), 'MMM d, yyyy') : ''}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}