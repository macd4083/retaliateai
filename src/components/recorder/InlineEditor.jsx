import React, { useEffect, useState } from 'react';

export default function InlineEditor({ html, onChange, disabled }) {
  const [layout, setLayout] = useState('split');
  const [localHTML, setLocalHTML] = useState(html || '');

  useEffect(() => {
    setLocalHTML(html || '');
  }, [html]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localHTML);
    }, 300);

    return () => clearTimeout(timer);
  }, [localHTML, onChange]);

  return (
    <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setLayout('editor')}
          className={`px-2.5 py-1 rounded-lg text-xs ${layout === 'editor' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          Editor
        </button>
        <button
          onClick={() => setLayout('split')}
          className={`px-2.5 py-1 rounded-lg text-xs ${layout === 'split' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          Split
        </button>
        <button
          onClick={() => setLayout('preview')}
          className={`px-2.5 py-1 rounded-lg text-xs ${layout === 'preview' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          Preview
        </button>
        {disabled && (
          <span className="ml-auto text-xs text-amber-300 bg-amber-950/50 border border-amber-800 rounded-md px-2 py-1">
            (recording — stop to edit)
          </span>
        )}
      </div>

      <div className={`flex-1 min-h-0 ${layout === 'split' ? 'grid md:grid-cols-2' : ''}`}>
        {layout !== 'preview' && (
          <textarea
            value={localHTML}
            onChange={(event) => setLocalHTML(event.target.value)}
            disabled={disabled}
            className="w-full h-full min-h-[320px] resize-none bg-zinc-950 text-zinc-100 p-4 font-mono text-xs border-r border-zinc-800 outline-none"
          />
        )}

        {layout !== 'editor' && (
          <iframe
            title="UI Recorder Preview"
            sandbox="allow-same-origin allow-scripts"
            srcDoc={localHTML}
            className="w-full h-full min-h-[320px] bg-white"
          />
        )}
      </div>
    </div>
  );
}
