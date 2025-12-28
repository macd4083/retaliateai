import React from 'react';

export default function JournalFilters({ filters, onFiltersChange }) {
  return (
    <div className="bg-white border-b border-slate-200 px-8 py-4">
      <div className="max-w-4xl mx-auto flex items-center gap-4">
        {/* Search */}
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search entries..."
            value={filters.searchQuery}
            onChange={(e) =>
              onFiltersChange({ ... filters, searchQuery: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Sort By */}
        <select
          value={filters.sortBy}
          onChange={(e) =>
            onFiltersChange({ ... filters, sortBy: e.target.value })
          }
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="created_at">Date</option>
          <option value="mood_rating">Mood</option>
        </select>

        {/* Sort Order */}
<button
  onClick={() =>
    onFiltersChange({
      ...filters,
      sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc',
    })
  }
  className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover: bg-slate-50"
  title={filters.sortOrder === 'asc' ? 'Ascending' : 'Descending'}
>
  {filters.sortOrder === 'asc' ?  '↑' : '↓'}
</button>
      </div>
    </div>
  );
}