import React from 'react';
import { Download, FileCode2, RotateCcw, Square, Play } from 'lucide-react';

export default function RecorderToolbar({
  status,
  diffStats,
  changesCount,
  onStart,
  onStop,
  onReset,
  onExportPatch,
  onExportJson,
}) {
  const hasDiff = (diffStats?.additions || 0) + (diffStats?.deletions || 0) > 0;

  return (
    <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 backdrop-blur p-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 mr-2">
        {status === 'recording' ? (
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        ) : (
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
        )}
        <span className="text-sm text-zinc-300">
          {status === 'recording' ? 'Recording…' : status === 'stopped' ? 'Recording stopped' : 'Recorder idle'}
        </span>
      </div>

      {status === 'idle' && (
        <button
          onClick={onStart}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm transition-colors"
        >
          <Play className="w-4 h-4" />
          Start Recording
        </button>
      )}

      {status === 'recording' && (
        <button
          onClick={onStop}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-900/40 border border-red-700 text-red-300 hover:bg-red-900/60 text-sm transition-colors"
        >
          <Square className="w-4 h-4" />
          Stop
        </button>
      )}

      {(status === 'recording' || status === 'stopped') && (
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-700 text-sm transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
      )}

      {status === 'recording' && (
        <span className="px-2.5 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-medium">
          Mutations: {changesCount}
        </span>
      )}

      {status === 'stopped' && (
        <>
          <span className="px-2.5 py-1 rounded-lg bg-green-950/50 border border-green-800 text-green-300 text-xs font-medium">
            +{diffStats?.additions || 0}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs font-medium">
            -{diffStats?.deletions || 0}
          </span>
        </>
      )}

      {status === 'stopped' && hasDiff && (
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onExportPatch}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white hover:bg-zinc-700 text-sm transition-colors"
          >
            <FileCode2 className="w-4 h-4" />
            .patch
          </button>
          <button
            onClick={onExportJson}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white hover:bg-zinc-700 text-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            .json
          </button>
        </div>
      )}
    </div>
  );
}
