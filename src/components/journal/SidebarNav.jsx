import React from "react";

export default function SidebarNav({ current, isAdmin, onNav }) {
  // current example: "journal"
  return (
    <nav className="flex flex-col items-stretch w-20 py-4 bg-white border-r border-slate-200 h-full">
      <button
        className={`mb-2 flex items-center justify-center h-12 w-12 mx-auto rounded-lg ${current === 'journal' ? 'bg-blue-100' : 'hover:bg-slate-100'}`}
        onClick={() => onNav('journal')}
        title="Journal"
      >
        <span className="text-lg">📔</span>
      </button>
      <button
        className={`mb-2 flex items-center justify-center h-12 w-12 mx-auto rounded-lg ${current === 'insights' ? 'bg-blue-100' : 'hover:bg-slate-100'}`}
        onClick={() => onNav('insights')}
        title="Insights (coming soon)"
        disabled
      >
        <span className="text-lg">💡</span>
      </button>
      <button
        className={`mb-2 flex items-center justify-center h-12 w-12 mx-auto rounded-lg ${current === 'goals' ? 'bg-blue-100' : 'hover:bg-slate-100'}`}
        onClick={() => onNav('goals')}
        title="Goals (coming soon)"
        disabled
      >
        <span className="text-lg">🎯</span>
      </button>
      {isAdmin && (
        <button
          className={`mb-2 flex items-center justify-center h-12 w-12 mx-auto rounded-lg ${current === 'users' ? 'bg-blue-100' : 'hover:bg-slate-100'}`}
          onClick={() => onNav('users')}
          title="Users"
        >
          <span className="text-lg">👤</span>
        </button>
      )}
    </nav>
  );
}