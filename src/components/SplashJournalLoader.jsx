import React from 'react';

/**
 * Fullscreen loader that reveals the app by shrinking a red "curtain" via clip-path,
 * while the inverse-logo proxy simultaneously shrinks + flies into the top-left logo.
 *
 * Timeline:
 * 1) show loader UI
 * 2) fade out loader UI (250ms)
 * 3) START AT THE SAME TIME:
 *    - curtain circle closes into top-left logo (clip-path)
 *    - proxy logo moves + scales into top-left logo (transform)
 */
export default function SplashJournalLoader({ targetRef, onDone }) {
  const curtainRef = React.useRef(null);
  const contentRef = React.useRef(null);
  const logoProxyRef = React.useRef(null);

  React.useEffect(() => {
    let raf1 = null;
    let raf2 = null;
    let t1 = null;
    let t2 = null;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      onDone?.();
      return;
    }

    const run = () => {
      const curtainEl = curtainRef.current;
      const contentEl = contentRef.current;
      const proxyEl = logoProxyRef.current;
      const targetEl = targetRef?.current;

      if (!curtainEl || !contentEl || !proxyEl || !targetEl) {
        onDone?.();
        return;
      }

      // Measure destination logo
      const targetRect = targetEl.getBoundingClientRect();

      // Measure proxy logo (center)
      const proxyRect = proxyEl.getBoundingClientRect();

      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;

      const proxyCenterX = proxyRect.left + proxyRect.width / 2;
      const proxyCenterY = proxyRect.top + proxyRect.height / 2;

      const dx = targetCenterX - proxyCenterX;
      const dy = targetCenterY - proxyCenterY;

      // Proxy scale -> match real logo size
      const scale = targetRect.width / proxyRect.width;

      // Start: curtain fully covers screen
      curtainEl.style.transition = 'none';
      curtainEl.style.clipPath = 'circle(160vmax at 50% 50%)';
      // Flush
      // eslint-disable-next-line no-unused-expressions
      curtainEl.getBoundingClientRect();

      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          // Phase 1: fade out content first
          contentEl.style.transition = 'opacity 250ms ease';
          contentEl.style.opacity = '0';

          // Phase 2: start BOTH animations at the exact same time
          t1 = setTimeout(() => {
            const durationMs = 950;
            const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';

            // (A) proxy logo shrink + fly
            proxyEl.style.transition = `transform ${durationMs}ms ${ease}`;
            proxyEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;

            // (B) curtain shrink into a tight circle around destination logo
            const endRadius = Math.max(
              14,
              Math.round(Math.min(targetRect.width, targetRect.height) * 0.55)
            );

            curtainEl.style.transition = `clip-path ${durationMs}ms ${ease}`;
            curtainEl.style.clipPath = `circle(${endRadius}px at ${targetCenterX}px ${targetCenterY}px)`;

            // Finish after the synchronized animation completes
            t2 = setTimeout(() => {
              onDone?.();
            }, durationMs + 60);
          }, 250);
        });
      });
    };

    run();

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [targetRef, onDone]);

  // Light red that matches your app’s common "bg-red-50" family
  const tintBg =
    'radial-gradient(1200px circle at 30% 20%, rgba(220,38,38,0.12), rgba(254,242,242,1) 35%, rgba(248,250,252,1) 70%)';

  // Curtain slightly stronger so the shrink is obvious
  const curtainBg =
    'radial-gradient(1000px circle at 40% 30%, rgba(220,38,38,0.22), rgba(254,242,242,1) 40%, rgba(254,242,242,0.92) 70%)';

  return (
    <div
      className="fixed inset-0 z-[9999] pointer-events-none"
      style={{ background: tintBg }}
    >
      {/* RED SCREEN that shrinks away revealing the app */}
      <div
        ref={curtainRef}
        className="absolute inset-0"
        style={{
          background: curtainBg,
          clipPath: 'circle(160vmax at 50% 50%)',
          willChange: 'clip-path',
        }}
      />

      {/* Loading UI (fades out first) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div ref={contentRef} className="text-center">
          <div className="relative mx-auto mb-4 h-24 w-24">
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

          <p className="text-slate-700 font-medium">Loading your journal...</p>
        </div>
      </div>

      {/* Proxy logo that moves+shrinks into the top-left logo */}
      <img
        ref={logoProxyRef}
        src="/inverselogo.png"
        alt=""
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 object-contain z-10"
        style={{
          transform: 'translate3d(-50%, -50%, 0) scale(1)',
          willChange: 'transform',
          filter: 'drop-shadow(0 10px 25px rgba(0,0,0,0.12))',
        }}
        draggable="false"
      />

      <style>{`
        @keyframes retaliate-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}