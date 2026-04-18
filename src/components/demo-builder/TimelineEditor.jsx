import React, { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronsLeft, ChevronsRight, Play } from 'lucide-react';

const PIXELS_PER_SECOND = 48;
const STEP_COLORS = {
  highlight: 'bg-red-600/80 border-red-500',
  tooltip: 'bg-sky-600/80 border-sky-500',
  modal: 'bg-violet-600/80 border-violet-500',
  pointer: 'bg-orange-600/80 border-orange-500',
  'cursor-path': 'bg-emerald-600/80 border-emerald-500',
  text: 'bg-amber-600/80 border-amber-500',
};

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function TimelineEditor({
  steps,
  currentStepIndex,
  setCurrentStepIndex,
  setIsPreviewMode,
  updateStep,
}) {
  const dragStateRef = useRef(null);

  const totalDurationMs = useMemo(
    () => steps.reduce((sum, step) => sum + step.delay + step.duration, 0),
    [steps],
  );

  const offsets = useMemo(() => {
    let acc = 0;
    return steps.map((step) => {
      const offset = acc;
      acc += step.delay;
      return offset;
    });
  }, [steps]);

  const handleDragMove = (event) => {
    if (!dragStateRef.current) return;
    const { step, startX, startDuration } = dragStateRef.current;
    const delta = event.clientX - startX;
    const nextDuration = Math.max(500, startDuration + Math.round((delta / PIXELS_PER_SECOND) * 1000));
    updateStep(step.id, { duration: nextDuration });
  };

  const stopDrag = () => {
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', stopDrag);
    dragStateRef.current = null;
  };

  const startResize = (event, step) => {
    event.preventDefault();
    dragStateRef.current = {
      step,
      startX: event.clientX,
      startDuration: step.duration,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', stopDrag);
  };

  useEffect(() => () => stopDrag(), []);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCurrentStepIndex(0);
              setIsPreviewMode(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-red-600 border border-red-700 text-white text-xs flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            Play
          </button>
          <button
            onClick={() => setCurrentStepIndex(currentStepIndex - 1)}
            className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentStepIndex(currentStepIndex + 1)}
            className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-400">Total: {formatSeconds(totalDurationMs)}</p>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div className="relative min-h-20" style={{ width: `${Math.max((totalDurationMs / 1000) * PIXELS_PER_SECOND + 280, 1000)}px` }}>
          {steps.map((step, index) => {
            const left = (offsets[index] / 1000) * PIXELS_PER_SECOND;
            const width = (step.duration / 1000) * PIXELS_PER_SECOND;
            return (
              <motion.button
                key={step.id}
                whileHover={{ scale: 1.02 }}
                onClick={() => setCurrentStepIndex(index)}
                className={`absolute left-0 h-10 rounded-lg border text-left px-3 text-xs text-white ${STEP_COLORS[step.type] || 'bg-zinc-700 border-zinc-600'} ${
                  currentStepIndex === index ? 'ring-2 ring-red-500/60' : ''
                }`}
                style={{
                  width: `${Math.max(width, 60)}px`,
                  transform: `translateX(${left}px)`,
                  top: `${Math.min(index * 12, 48)}px`,
                }}
              >
                <span className="font-semibold">{step.type}</span>
                <span className="ml-1 text-[10px] opacity-80">{formatSeconds(step.duration)}</span>
                <span className="ml-1 text-[10px] opacity-70">delay:{formatSeconds(step.delay)}</span>
                <span
                  className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/20"
                  onMouseDown={(event) => startResize(event, step)}
                />
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
