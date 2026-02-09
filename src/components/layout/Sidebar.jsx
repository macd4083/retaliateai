import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Lightbulb, Target, Users, Sparkles, Heart } from 'lucide-react';
import { format } from 'date-fns';

export default function Sidebar({
  activeTab,
  onTabChange,
  user,
  entries = [],
  selectedEntryId,
  onSelectEntry,
}) {
  const isAdmin = user?.role === 'admin';
  const [search, setSearch] = useState('');
  const [hoveredTab, setHoveredTab] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimeoutRef = useRef(null);
  
  const tabs = [
    { 
      id: 'journal', 
      icon: BookOpen, 
      label: 'Journal',
      tooltip: {
        title: 'Why It Works',
        description: 'Activates your Default Mode Network—your brain\'s introspection mode. Unstructured writing reduces cognitive filtering, allowing subconscious patterns to surface. Research shows 15-20 minutes of expressive writing improves emotional regulation and immune function.'
      }
    },
    { 
      id: 'clarity', 
      icon: Sparkles, 
      label: 'Clarity',
      tooltip: {
        title: 'Why It Works',
        description: 'Writing externalizes problems from your limited working memory (4-7 items). Seeing thoughts on screen engages visual processing, allowing you to spot patterns and contradictions invisible when thoughts are swirling internally.'
      }
    },
    { 
      id: 'gratitude', 
      icon: Heart, 
      label: 'Gratitude',
      tooltip: {
        title: 'Why It Works',
        description: 'Stimulates the hypothalamus (regulates stress) and releases dopamine. Your brain has a negativity bias—gratitude practices counteract this by training attention toward positive stimuli. Just 2 minutes daily measurably increases positive affect within 2 weeks.'
      }
    },
    { 
      id: 'insights', 
      icon: Lightbulb, 
      label: 'Insights',
      tooltip: {
        title: 'Why It Works',
        description: 'Structured reflection builds metacognition—awareness of your own thought patterns. Specific questions activate focused neural pathways rather than diffuse anxiety circuits. Your brain is a question-answering machine.'
      }
    },
    { 
      id: 'goals', 
      icon: Target, 
      label: 'Goals',
      tooltip: {
        title: 'Why It Works',
        description: 'Writing goals activates your Reticular Activating System (RAS)—your brain\'s filter that prioritizes what to notice. Creates a psychological contract with yourself. Implementation intentions ("When X, I will Y") increase follow-through by 2-3x.'
      }
    },
  ];
  if (isAdmin) tabs.push({ id: 'users', icon: Users, label: 'Users', tooltip: null });

  const handleMouseEnter = (tabId) => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    setHoveredTab(tabId);
    
    // Set a 500ms delay before showing tooltip
    hoverTimeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 500);
  };

  const handleMouseLeave = () => {
    // Clear the timeout if mouse leaves before 500ms
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    setHoveredTab(null);
    setShowTooltip(false);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const filteredEntries = entries.filter((entry) => {
    if (!search) return true;
    const query = search.toLowerCase();
    const title = entry.title ? entry.title.toLowerCase() : '';
    const dateStr = entry.created_at ? format(new Date(entry.created_at), 'MMM d, yyyy').toLowerCase() : '';
    return title.includes(query) || dateStr.includes(query);
  });

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-full">
      {/* Nav buttons at top */}
      <div className="p-4 space-y-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isHovered = hoveredTab === tab.id;
          const shouldShowTooltip = isHovered && showTooltip && tab.tooltip;
          
          return (
            <div 
              key={tab.id} 
              className="relative"
              onMouseEnter={() => handleMouseEnter(tab.id)}
              onMouseLeave={handleMouseLeave}
            >
              <button
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
              
              {/* Hover tooltip with fade-in animation */}
              {shouldShowTooltip && (
                <div 
                  className="absolute left-full ml-2 top-0 z-50 w-72 pointer-events-none animate-in fade-in duration-200"
                >
                  <div className="bg-slate-50 border border-slate-200 rounded-lg shadow-lg p-4 text-slate-600">
                    <div className="font-semibold text-sm mb-2 text-slate-700">
                      {tab.tooltip.title}
                    </div>
                    <div className="text-xs leading-relaxed">
                      {tab.tooltip.description}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Divider */}
      <div className="border-b border-slate-200 my-2"></div>
      {/* Journal entry search/list below nav always */}
      <div className="flex-1 flex flex-col px-4 pb-4 overflow-y-auto">
        <input
          type="text"
          placeholder="Search by title or date..."
          className="w-full px-3 py-2 border border-slate-300 rounded-md mb-2"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex-1 overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <div className="text-slate-400 py-8 text-center">
              {search ? 'No matching entries found.' : 'No journal entries yet.'}
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
    </div>
  );
}