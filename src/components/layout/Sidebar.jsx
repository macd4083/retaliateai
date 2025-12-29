import React from 'react';
import { BookOpen, Lightbulb, Target, Users } from 'lucide-react';

export default function Sidebar({ activeTab, onTabChange, user }) {
  const isAdmin = user?.role === 'admin';

  const tabs = [
    { id: 'journal', icon: BookOpen, label: 'Journal' },
    { id: 'insights', icon: Lightbulb, label: 'Insights' },
    { id: 'goals', icon: Target, label: 'Goals' },
  ];

  if (isAdmin) {
    tabs.push({ id: 'users', icon: Users, label: 'Users' });
  }

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-full">
      {/* Navigation Tabs */}
      <div className="p-4 space-y-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}