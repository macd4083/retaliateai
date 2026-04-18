import React from 'react';
import { motion } from 'framer-motion';

export default function HighlightOverlay({ step, isPreview, targetRect, onAdvance }) {
  const color = step?.config?.color || '#ef4444';
  const padding = step?.config?.padding ?? 8;
  const borderRadius = step?.config?.borderRadius ?? 8;

  const fallbackRect = {
    left: '35%',
    top: '35%',
    width: '30%',
    height: '20%',
  };

  const rectStyle = targetRect
    ? {
        left: targetRect.left - padding,
        top: targetRect.top - padding,
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
      }
    : fallbackRect;

  return (
    <div className="absolute inset-0 pointer-events-none">
      <motion.div
        className="absolute border-2"
        style={{
          ...rectStyle,
          borderColor: color,
          borderRadius,
        }}
        animate={step?.config?.pulse ? { boxShadow: [`0 0 0 0px ${color}66`, `0 0 0 12px ${color}00`] } : {}}
        transition={step?.config?.pulse ? { duration: 1.2, repeat: Infinity, ease: 'easeOut' } : undefined}
      />
      {!isPreview && (
        <div className="absolute left-3 bottom-3 rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-300 pointer-events-auto">
          Selector: {step?.selector || 'No selector'}
          <button onClick={onAdvance} className="ml-2 text-red-400 hover:text-red-300">Test Next</button>
        </div>
      )}
    </div>
  );
}
