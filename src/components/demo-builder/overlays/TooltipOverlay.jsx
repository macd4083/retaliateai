import React from 'react';
import { motion } from 'framer-motion';

const positionStyles = {
  top: { x: '-50%', y: '-120%' },
  bottom: { x: '-50%', y: '120%' },
  left: { x: '-115%', y: '-50%' },
  right: { x: '115%', y: '-50%' },
};

export default function TooltipOverlay({ step, targetRect }) {
  const rect = targetRect || { left: 640, top: 400, width: 0, height: 0 };
  const position = step?.config?.position || 'bottom';
  const shift = positionStyles[position] || positionStyles.bottom;

  return (
    <div className="absolute inset-0 pointer-events-none">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute w-72 rounded-xl bg-zinc-900 border border-red-800 p-3 shadow-2xl"
        style={{
          left: rect.left + rect.width / 2,
          top: rect.top + rect.height / 2,
          transform: `translate(${shift.x}, ${shift.y})`,
        }}
      >
        <p className="text-xs text-zinc-100 leading-relaxed">{step?.config?.text || 'Tooltip text'}</p>
        {step?.config?.arrow && (
          <span className="block mt-2 h-2 w-2 rotate-45 bg-zinc-900 border-r border-b border-red-800" />
        )}
      </motion.div>
    </div>
  );
}
