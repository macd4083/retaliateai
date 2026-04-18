import React from 'react';
import { motion } from 'framer-motion';

const STYLE_MAP = {
  card: 'bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm shadow-xl',
  bubble: 'bg-red-600 text-white rounded-2xl px-4 py-2 text-sm shadow-xl',
  inline: 'bg-black/60 border border-zinc-600 rounded-md px-3 py-1.5 text-xs',
};

export default function TextOverlay({ step }) {
  const x = step?.config?.textX ?? 50;
  const y = step?.config?.textY ?? 20;
  const style = step?.config?.style || 'card';

  return (
    <div className="absolute inset-0 pointer-events-none">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`absolute text-zinc-100 max-w-sm ${STYLE_MAP[style] || STYLE_MAP.card}`}
        style={{
          left: `${x}%`,
          top: `${y}%`,
          transform: 'translate(-50%, -50%)',
        }}
      >
        {step?.config?.content || 'Text instruction'}
      </motion.div>
    </div>
  );
}
