import React, { useEffect, useState } from 'react';

export default function SplashJournalLoader({ targetRef, onDone }) {
  const [phase, setPhase] = useState('loading'); // 'loading' | 'fadeOut' | 'closing'
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Wait a tiny bit for DOM to be ready
    setMounted(true);
    
    // Timeline:
    // 0-1500ms: spinner + text visible
    // 1500-1750ms: fade out text/spinner
    // 1750-2750ms: circle-close + logo flight (1000ms)
    const fadeTimer = setTimeout(() => setPhase('fadeOut'), 1500);
    const closeTimer = setTimeout(() => setPhase('closing'), 1750);
    const doneTimer = setTimeout(() => onDone?.(), 2750);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(closeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  // Calculate positions after mount
  const getTargetPosition = () => {
    if (!mounted || !targetRef?.current) {
      return { x: 100, y: 50 }; // Fallback: approximate top-left position
    }
    const rect = targetRef.current.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      scale: rect.width / 80
    };
  };

  const target = getTargetPosition();
  const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
  const translateX = target.x - centerX;
  const translateY = target.y - centerY;
  const finalScale = target.scale || 0.7;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-red-50 flex items-center justify-center overflow-hidden"
      style={{
        clipPath:
          phase === 'closing'
            ? `circle(0% at ${target.x}px ${target.y}px)`
            : 'circle(100%)',
        transition: phase === 'closing' ? 'clip-path 1000ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
      }}
    >
      {/* Spinner + Logo + Text container */}
      <div
        className="text-center"
        style={{
          opacity: phase === 'loading' ? 1 : 0,
          transition: phase === 'fadeOut' ? 'opacity 250ms ease-out' : 'none',
        }}
      >
        {/* Spinning ring with logo inside */}
        <div className="relative mx-auto mb-6 h-20 w-20">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              borderWidth: 4,
              borderStyle: 'solid',
              borderColor: 'rgba(148,163,184,0.45)',
              borderTopColor: 'rgba(220,38,38,0.85)',
              animation: 'retaliate-spin 0.9s linear infinite',
            }}
          />
          <img
            src="/inverselogo.png"
            alt="Retaliate AI"
            className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 object-contain"
            draggable="false"
          />
        </div>

        {/* Loading text */}
        <p className="text-slate-700 font-medium text-lg">Loading your journal...</p>
      </div>

      {/* Flying logo (separate, starts invisible, then animates during 'closing') */}
      <img
        src="/inverselogo.png"
        alt=""
        className="absolute object-contain pointer-events-none"
        style={{
          left: '50%',
          top: '50%',
          width: '80px',
          height: '80px',
          marginLeft: '-40px',
          marginTop: '-40px',
          opacity: phase === 'closing' ? 1 : 0,
          transform:
            phase === 'closing'
              ? `translate(${translateX}px, ${translateY}px) scale(${finalScale})`
              : 'translate(0, 0) scale(1)',
          transition:
            phase === 'closing'
              ? 'transform 1000ms cubic-bezier(0.4, 0, 0.2, 1), opacity 100ms ease-in'
              : 'none',
        }}
        draggable="false"
      />

      {/* Keyframes for spinner */}
      <style>{`
        @keyframes retaliate-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}