import React, { useEffect, useState, useRef } from 'react';

export default function SplashJournalLoader({ onDone }) {
  const [phase, setPhase] = useState('loading'); // 'loading' | 'fadeOut' | 'closing'
  const [targetPos, setTargetPos] = useState({ x: 100, y: 50, scale: 0.7 });
  const overlayRef = useRef(null);

  useEffect(() => {
    // Measure the top-left logo position after a brief delay to ensure DOM is ready
    const measureTarget = () => {
      const logoElement = document.querySelector('[data-top-left-logo]');
      if (logoElement) {
        const rect = logoElement.getBoundingClientRect();
        setTargetPos({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          scale: rect.width / 80
        });
      }
    };

    setTimeout(measureTarget, 50);

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

  const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
  const translateX = targetPos.x - centerX;
  const translateY = targetPos.y - centerY;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] bg-red-50 flex items-center justify-center overflow-hidden"
      style={{
        clipPath:
          phase === 'closing'
            ? `circle(0% at ${targetPos.x}px ${targetPos.y}px)`
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
              ? `translate(${translateX}px, ${translateY}px) scale(${targetPos.scale})`
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