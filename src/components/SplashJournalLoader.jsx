import React, { useEffect, useState } from 'react';

export default function SplashJournalLoader({ targetRef, onDone }) {
  const [phase, setPhase] = useState('loading'); // 'loading' | 'fadeOut' | 'closing'
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    // Measure the destination logo position
    if (targetRef?.current) {
      const rect = targetRef.current.getBoundingClientRect();
      setTargetRect(rect);
    }

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
  }, [targetRef, onDone]);

  // Calculate logo final position (center of top-left logo)
  const finalX = targetRect ? targetRect.left + targetRect.width / 2 : 0;
  const finalY = targetRect ? targetRect.top + targetRect.height / 2 : 0;

  // Center of screen (starting position)
  const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;

  // Translation needed to move center logo to top-left
  const translateX = finalX - centerX;
  const translateY = finalY - centerY;

  // Scale factor to shrink logo from ~80px to ~56px (w-14 = 3.5rem = 56px)
  const finalScale = targetRect ? targetRect.width / 80 : 0.7;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-red-50 flex items-center justify-center overflow-hidden"
      style={{
        clipPath:
          phase === 'closing'
            ? `circle(0% at ${finalX}px ${finalY}px)`
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