import React, { useMemo, useState } from 'react';
import { diffToUnifiedPatch } from '../../utils/diffEngine';

export default function ExportPanel({
  isOpen,
  onClose,
  diffLines,
  diffStats,
  changes,
  onExportPatch,
  onExportJson,
}) {
  const [copied, setCopied] = useState(false);

  const patchPreview = useMemo(() => {
    const patch = diffToUnifiedPatch(diffLines || [], 'original.html', 'modified.html', 3);
    return patch.split('\n').slice(0, 60).join('\n');
  }, [diffLines]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-zinc-100 font-semibold">Export Changes</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">Additions: <span className="text-green-300">{diffStats?.additions || 0}</span></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">Deletions: <span className="text-red-300">{diffStats?.deletions || 0}</span></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">Mutations: <span className="text-zinc-100">{changes?.length || 0}</span></div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 text-xs text-zinc-400">Unified patch preview (first 60 lines)</div>
            <pre className="p-3 text-xs text-zinc-300 overflow-auto max-h-80 whitespace-pre-wrap">{patchPreview}</pre>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onExportPatch}
              className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white hover:bg-zinc-700 text-sm"
            >
              Download .patch
            </button>
            <button
              onClick={onExportJson}
              className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white hover:bg-zinc-700 text-sm"
            >
              Download .json
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(diffToUnifiedPatch(diffLines || [], 'original.html', 'modified.html', 3));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="px-3 py-2 rounded-xl bg-red-900/40 border border-red-700 text-red-300 hover:bg-red-900/60 text-sm"
            >
              {copied ? 'Copied!' : 'Copy patch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
