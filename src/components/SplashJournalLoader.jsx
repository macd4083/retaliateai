import React from 'react';

/**
 * Fullscreen loader that:
 * - shows red-tinted background + spinner + logo + text
 * - fades out content
 * - performs a circular "closing" transition into the target logo (top-left)
 *
 * Props:
 * - targetRef: React ref to the top-left logo IMG element
 * - onDone: callback after animation completes (parent should stop rendering this loader)
 */
export default function SplashJournalLoader({ targetRef, onDone }) {
  const overlayRef = React.useRef(null);
  const circleRef = React.useRef(null);
  const contentRef = React.useRef(null);
  const logoProxyRef = React.useRef(null);

  React.useEffect(() => {
    let raf1 = null;
    let raf2 = null;
    let timeout1 = null;
    let timeout2 = null;
    let timeout3 = null;

    const run = async () => {
      const overlayEl = overlayRef.current;
      const circleEl = circleRef.current;
      const contentEl = contentRef.current;
      const proxyEl = logoProxyRef.current;
      const targetEl = targetRef?.current;

      if (!overlayEl || !circleEl || !contentEl || !proxyEl || !targetEl) {
        // If something isn't mounted yet, just finish (fail-safe)
        onDone?.();
        return;
      }

      // Measure target logo
      const targetRect = targetEl.getBoundingClientRect();

      // Place proxy at center initially (we'll animate it to target)
      const proxyRect = proxyEl.getBoundingClientRect();
      const proxyCenterX = proxyRect.left + proxyRect.width / 2;
      const proxyCenterY = proxyRect.top + proxyRect.height / 2;

      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;

      const dx = targetCenterX - proxyCenterX;
      const dy = targetCenterY - proxyCenterY;

      // Scale proxy from center size -> target size
      const scale = targetRect.width / proxyRect.width;

      // ---- Timeline ----
      // Give the browser one frame to paint the initial loader state
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          // 1) Fade out the spinner/text slightly BEFORE the circle collapse
          //    total fade duration 250ms
          contentEl.style.transition = 'opacity 250ms ease';
          contentEl.style.opacity = '0';

          // start circle collapse after 250ms (so content is gone)
          timeout1 = setTimeout(() => {
            // 2) Move+scale the proxy logo into the corner
            // use a smooth "spring-like" cubic-bezier
            proxyEl.style.transition = 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)';
            proxyEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;

            // 3) Circle closing around the corner logo:
            // We implement this as a shrinking circle "hole" via clip-path.
            //
            // Start fully open: huge circle
            // End: tiny circle at target center
            const startRadius = 160; // vmin
            const endRadius = Math.max(16, targetRect.width * 0.6); // px-ish feel

            circleEl.style.transition = 'clip-path 900ms cubic-bezier(0.22, 1, 0.36, 1)';
            circleEl.style.clipPath = `circle(${endRadius}px at ${targetCenterX}px ${targetCenterY}px)`;

            // Also fade overlay slightly near end (optional, helps feel clean)
            overlayEl.style.transition = 'opacity 250ms ease';
            timeout2 = setTimeout(() => {
              overlayEl.style.opacity = '0';
            }, 900 - 250);

            // Finish after the main transition ends
            timeout3 = setTimeout(() => {
              onDone?.();
            }, 900 + 40);
          }, 250);
        });
      });

      // Initialize clip-path AFTER first paint (so transition happens)
      circleEl.style.clipPath = `circle(160vmax at 50% 50%)`;
      // then immediately set to start value (fully open) with no transition
      circleEl.style.transition = 'none';
      circleEl.style.clipPath = `circle(160vmax at 50% 50%)`;

      // Force style flush then set the animated end state later
      // (We set end state in timeout1)
      // eslint-disable-next-line no-unused-expressions
      circleEl.getBoundingClientRect();
      circleEl.style.transition = 'clip-path 900ms cubic-bezier(0.22, 1, 0.36, 1)';
    };

    run();

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timeout1) clearTimeout(timeout1);
      if (timeout2) clearTimeout(timeout2);
      if (timeout3) clearTimeout(timeout3);
    };
  }, [targetRef, onDone]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        // light red similar vibe to your red accents
        background: 'radial-gradient(1200px circle at 30% 20%, rgba(220,38,38,0.18), rgba(248,250,252,1) 55%)',
        opacity: 1,
      }}
    >
      {/* This layer is what we clip into a closing circle */}
      <div
        ref={circleRef}
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(1200px circle at 30% 20%, rgba(220,38,38,0.18), rgba(248,250,252,1) 55%)',
          clipPath: 'circle(160vmax at 50% 50%)',
          willChange: 'clip-path',
        }}
      />

      {/* Foreground content */}
      <div ref={contentRef} className="relative z-10 text-center">
        <div className="relative mx-auto mb-4 h-24 w-24">
          {/* Spinning ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              borderWidth: 4,
              borderStyle: 'solid',
              borderColor: 'rgba(148,163,184,0.45)', // slate-ish
              borderTopColor: 'rgba(220,38,38,0.85)', // red-600-ish
              animation: 'spin 0.9s linear infinite',
            }}
          />
          {/* Logo in center */}
          <img
            src="/inverselogo.png"
            alt="Retaliate AI"
            className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 object-contain"
            draggable="false"
          />
        </div>

        <p className="text-slate-700 font-medium">Loading your journal...</p>
      </div>

      {/* Proxy logo used for motion into the top-left */}
      <img
        ref={logoProxyRef}
        src="/inverselogo.png"
        alt=""
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 object-contain z-20 pointer-events-none"
        style={{
          transform: 'translate3d(-50%, -50%, 0) scale(1)',
          willChange: 'transform',
          filter: 'drop-shadow(0 10px 25px rgba(0,0,0,0.12))',
        }}
        draggable="false"
      />

      {/* Keyframes for the ring spin (inline so you don't have to touch CSS files) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}