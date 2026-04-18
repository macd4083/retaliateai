import React, { useEffect, useRef } from 'react';

const BADGE_CLASSES = {
  attribute: 'bg-blue-950/50 text-blue-300 border-blue-800',
  characterData: 'bg-amber-950/50 text-amber-300 border-amber-800',
  childList: 'bg-purple-950/50 text-purple-300 border-purple-800',
  resize: 'bg-green-950/50 text-green-300 border-green-800',
  style: 'bg-pink-950/50 text-pink-300 border-pink-800',
};

function renderChangeDetails(change) {
  if (change.type === 'resize') {
    const oldW = Math.round(change.oldRect?.width || 0);
    const oldH = Math.round(change.oldRect?.height || 0);
    const newW = Math.round(change.newRect?.width || 0);
    const newH = Math.round(change.newRect?.height || 0);
    return `${oldW}×${oldH} → ${newW}×${newH}`;
  }

  if (change.type === 'childList') {
    return `+${change.addedCount || 0} added / -${change.removedCount || 0} removed`;
  }

  if (change.attributeName) {
    return `attr: ${change.attributeName}`;
  }

  if (typeof change.oldValue === 'string' || typeof change.newValue === 'string') {
    return `${String(change.oldValue || '')} → ${String(change.newValue || '')}`;
  }

  return '';
}

export default function ChangeLogPanel({ changes, onClear }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [changes]);

  return (
    <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Change Log</h3>
        <button
          onClick={onClear}
          className="text-xs px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-700"
        >
          Clear
        </button>
      </div>

      {changes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center text-zinc-500 text-sm gap-2">
          <div className="w-10 h-10 rounded-full border border-zinc-700 bg-zinc-800/60 flex items-center justify-center">📝</div>
          <p>No mutation events yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {changes.map((change) => (
            <div key={change.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className={`px-2 py-0.5 rounded-md border ${BADGE_CLASSES[change.type] || 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}>
                  {change.type}
                </span>
                <span className="text-zinc-500">{new Date(change.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-zinc-300 break-all">{change.targetSelector || '(unknown selector)'}</p>
              {change.attributeName && <p className="text-zinc-400">attribute: {change.attributeName}</p>}
              {renderChangeDetails(change) && <p className="text-zinc-400 break-all">{renderChangeDetails(change)}</p>}
              {(change.type === 'attribute' || change.type === 'style' || change.type === 'characterData') && (
                <div className="text-zinc-500 space-y-0.5">
                  {typeof change.oldValue !== 'undefined' && <p>old: {String(change.oldValue)}</p>}
                  {typeof change.newValue !== 'undefined' && <p>new: {String(change.newValue)}</p>}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
