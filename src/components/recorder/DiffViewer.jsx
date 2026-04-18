import React, { useMemo, useState } from 'react';

const CONTEXT_LINES = 4;

function computeRuns(diffLines) {
  const runs = [];
  if (!diffLines.length) return runs;

  let currentType = diffLines[0].type;
  let start = 0;

  for (let i = 1; i <= diffLines.length; i += 1) {
    if (i === diffLines.length || diffLines[i].type !== currentType) {
      runs.push({
        id: `${start}-${i - 1}`,
        type: currentType,
        start,
        end: i - 1,
        lines: diffLines.slice(start, i),
      });
      start = i;
      currentType = diffLines[i]?.type;
    }
  }

  return runs;
}

function UnifiedLine({ line }) {
  const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
  const rowClass = line.type === 'insert'
    ? 'bg-green-950/60 text-green-300'
    : line.type === 'delete'
      ? 'bg-red-950/60 text-red-300'
      : 'text-zinc-300';

  return (
    <div className={`grid grid-cols-[3rem_3rem_1.75rem_1fr] gap-2 px-3 py-1 font-mono text-xs border-b border-zinc-900/50 ${rowClass}`}>
      <span className="text-zinc-500 text-right">{line.originalLineNum ?? ''}</span>
      <span className="text-zinc-500 text-right">{line.modifiedLineNum ?? ''}</span>
      <span>{prefix}</span>
      <span className="whitespace-pre-wrap break-all">{line.value}</span>
    </div>
  );
}

function SplitLine({ line }) {
  if (line.type === 'equal') {
    return (
      <div className="grid grid-cols-2 divide-x divide-zinc-800 border-b border-zinc-900/50 font-mono text-xs text-zinc-300">
        <div className="px-3 py-1 grid grid-cols-[3rem_1fr] gap-2"><span className="text-zinc-500 text-right">{line.originalLineNum}</span><span className="whitespace-pre-wrap break-all">{line.value}</span></div>
        <div className="px-3 py-1 grid grid-cols-[3rem_1fr] gap-2"><span className="text-zinc-500 text-right">{line.modifiedLineNum}</span><span className="whitespace-pre-wrap break-all">{line.value}</span></div>
      </div>
    );
  }

  if (line.type === 'delete') {
    return (
      <div className="grid grid-cols-2 divide-x divide-zinc-800 border-b border-zinc-900/50 font-mono text-xs">
        <div className="px-3 py-1 grid grid-cols-[3rem_1fr] gap-2 bg-red-950/60 text-red-300"><span className="text-red-500 text-right">{line.originalLineNum}</span><span className="whitespace-pre-wrap break-all">{line.value}</span></div>
        <div className="px-3 py-1 text-zinc-700">&nbsp;</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 divide-x divide-zinc-800 border-b border-zinc-900/50 font-mono text-xs">
      <div className="px-3 py-1 text-zinc-700">&nbsp;</div>
      <div className="px-3 py-1 grid grid-cols-[3rem_1fr] gap-2 bg-green-950/60 text-green-300"><span className="text-green-500 text-right">{line.modifiedLineNum}</span><span className="whitespace-pre-wrap break-all">{line.value}</span></div>
    </div>
  );
}

export default function DiffViewer({ diffLines, diffStats, viewMode, onChangeViewMode }) {
  const [expandedRunIds, setExpandedRunIds] = useState(() => new Set());
  const [expandAll, setExpandAll] = useState(false);

  const runs = useMemo(() => computeRuns(diffLines || []), [diffLines]);
  const hasDiff = (diffStats?.additions || 0) + (diffStats?.deletions || 0) > 0;

  if (!diffLines?.length) {
    return (
      <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-center text-zinc-500 text-sm px-4 text-center">
        Start and stop recording to generate a diff.
      </div>
    );
  }

  if (!hasDiff) {
    return (
      <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-center text-zinc-500 text-sm px-4 text-center">
        No changes detected between snapshots.
      </div>
    );
  }

  return (
    <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <button
          onClick={() => onChangeViewMode('unified')}
          className={`px-2.5 py-1 rounded-lg text-xs ${viewMode === 'unified' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          Unified
        </button>
        <button
          onClick={() => onChangeViewMode('split')}
          className={`px-2.5 py-1 rounded-lg text-xs ${viewMode === 'split' ? 'bg-red-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          Split
        </button>
        <button
          onClick={() => {
            setExpandAll((prev) => !prev);
            setExpandedRunIds(new Set());
          }}
          className="ml-auto px-2.5 py-1 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-zinc-800"
        >
          {expandAll ? 'Collapse long runs' : 'Expand all'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {runs.map((run) => {
          const shouldCollapse = run.type === 'equal' && run.lines.length > CONTEXT_LINES * 2 && !expandAll && !expandedRunIds.has(run.id);

          if (!shouldCollapse) {
            return run.lines.map((line) => (viewMode === 'unified'
              ? <UnifiedLine key={`${line.type}-${line.originalLineNum}-${line.modifiedLineNum}-${line.value}`} line={line} />
              : <SplitLine key={`${line.type}-${line.originalLineNum}-${line.modifiedLineNum}-${line.value}`} line={line} />));
          }

          const head = run.lines.slice(0, CONTEXT_LINES);
          const tail = run.lines.slice(-CONTEXT_LINES);
          const hiddenCount = run.lines.length - head.length - tail.length;

          return (
            <React.Fragment key={run.id}>
              {head.map((line) => (viewMode === 'unified'
                ? <UnifiedLine key={`head-${line.originalLineNum}-${line.modifiedLineNum}`} line={line} />
                : <SplitLine key={`head-${line.originalLineNum}-${line.modifiedLineNum}`} line={line} />))}

              <button
                onClick={() => setExpandedRunIds((prev) => {
                  const next = new Set(prev);
                  next.add(run.id);
                  return next;
                })}
                className="w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900/80 border-y border-zinc-800 text-left"
              >
                ↕ {hiddenCount} unchanged lines (click to expand)
              </button>

              {tail.map((line) => (viewMode === 'unified'
                ? <UnifiedLine key={`tail-${line.originalLineNum}-${line.modifiedLineNum}`} line={line} />
                : <SplitLine key={`tail-${line.originalLineNum}-${line.modifiedLineNum}`} line={line} />))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
