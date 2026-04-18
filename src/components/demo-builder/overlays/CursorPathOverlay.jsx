import React, { useEffect, useMemo } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';

export default function CursorPathOverlay({ step, isPreview }) {
  const points = useMemo(() => step?.config?.points || [], [step?.config?.points]);
  const x = useMotionValue(points[0]?.x || 50);
  const y = useMotionValue(points[0]?.y || 50);

  useEffect(() => {
    if (!isPreview || points.length < 2) {
      x.set(points[0]?.x || 50);
      y.set(points[0]?.y || 50);
      return undefined;
    }

    const controls = [];
    let active = true;

    async function run() {
      const perSegment = Math.max(step?.duration || 3000, 300) / Math.max(points.length - 1, 1);
      for (let index = 1; index < points.length; index += 1) {
        if (!active) break;
        const target = points[index];
        controls.push(animate(x, target.x, { duration: perSegment / 1000, ease: 'easeInOut' }));
        controls.push(animate(y, target.y, { duration: perSegment / 1000, ease: 'easeInOut' }));
        await new Promise((resolve) => setTimeout(resolve, perSegment));
      }
    }

    run();

    return () => {
      active = false;
      controls.forEach((control) => control.stop());
    };
  }, [isPreview, points, step?.duration, x, y]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {step?.config?.showTrail && points.map((point, index) => (
        <span
          key={`${point.x}-${point.y}-${index}`}
          className="absolute block h-2 w-2 rounded-full bg-red-500/50"
          style={{ left: `${point.x}%`, top: `${point.y}%`, transform: 'translate(-50%, -50%)' }}
        />
      ))}
      <motion.div style={{ left: x, top: y }} className="absolute -translate-x-1/2 -translate-y-1/2">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="drop-shadow-lg">
          <path d="M4 3l8.5 8.5M4 3l3 13 3.5-4.5L15 15 16.5 13.5 12 9l4.5-3.5z" />
        </svg>
      </motion.div>
    </div>
  );
}
