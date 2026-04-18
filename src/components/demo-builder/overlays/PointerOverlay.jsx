import React from 'react';
import { motion } from 'framer-motion';

function animationFor(type) {
  if (type === 'bounce') {
    return {
      animate: { y: [0, -10, 0] },
      transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' },
    };
  }
  if (type === 'click') {
    return {
      animate: { scale: [1, 0.85, 1], rotate: [0, -6, 0] },
      transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' },
    };
  }

  return {
    animate: { scale: [1, 1.08, 1] },
    transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' },
  };
}

export default function PointerOverlay({ step }) {
  const x = step?.config?.x ?? 50;
  const y = step?.config?.y ?? 50;
  const size = step?.config?.size ?? 36;
  const color = step?.config?.pointerColor || '#ef4444';
  const motionConfig = animationFor(step?.config?.animation);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <motion.div
        className="absolute"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          color,
        }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, ...motionConfig.animate }}
        transition={{ opacity: { duration: 0.2 }, ...motionConfig.transition }}
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="drop-shadow-lg -translate-x-1/2 -translate-y-1/2">
          <path d="M4 3l8.5 8.5M4 3l3 13 3.5-4.5L15 15 16.5 13.5 12 9l4.5-3.5z" />
        </svg>
      </motion.div>
    </div>
  );
}
