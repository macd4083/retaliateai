import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import SnapshotLoader from './SnapshotLoader';
import HighlightOverlay from './overlays/HighlightOverlay';
import TooltipOverlay from './overlays/TooltipOverlay';
import ModalOverlay from './overlays/ModalOverlay';
import PointerOverlay from './overlays/PointerOverlay';
import CursorPathOverlay from './overlays/CursorPathOverlay';
import TextOverlay from './overlays/TextOverlay';

function resolveTargetRect(step, { iframeRef }) {
  if (!step?.selector) return null;

  try {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return null;
    const target = doc.querySelector(step.selector);
    if (!target) return null;
    const targetRect = target.getBoundingClientRect();
    return {
      left: targetRect.left,
      top: targetRect.top,
      width: targetRect.width,
      height: targetRect.height,
    };
  } catch (_error) {
    return null;
  }
}

function getOverlayComponent(type) {
  const components = {
    highlight: HighlightOverlay,
    tooltip: TooltipOverlay,
    modal: ModalOverlay,
    pointer: PointerOverlay,
    'cursor-path': CursorPathOverlay,
    text: TextOverlay,
  };
  return components[type] || null;
}

function buildCssSelector(element) {
  if (!element || !element.tagName) return null;
  if (element.id) return `#${element.id}`;
  if (element.classList?.length) {
    return `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join('.')}`;
  }
  return element.tagName.toLowerCase();
}

export default function DemoCanvas({ demo, selectedStep, updateStep, updateDemo, onAdvance }) {
  const containerRef = useRef(null);
  const frameRef = useRef(null);
  const iframeRef = useRef(null);
  const [scale, setScale] = useState(1);

  const width = demo.viewport?.width || 1280;
  const height = demo.viewport?.height || 800;

  useEffect(() => {
    const calculateScale = () => {
      if (!containerRef.current) return;
      const bounds = containerRef.current.getBoundingClientRect();
      const nextScale = Math.min(bounds.width / width, bounds.height / height, 1);
      setScale(nextScale);
    };

    calculateScale();
    window.addEventListener('resize', calculateScale);

    const observer = new ResizeObserver(calculateScale);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', calculateScale);
      observer.disconnect();
    };
  }, [height, width]);

  const hasSnapshot = Boolean(demo.snapshotUrl || demo.snapshotHTML);

  const targetRect = useMemo(
    () => resolveTargetRect(selectedStep, { iframeRef }),
    [selectedStep],
  );

  const handleOverlayClick = (event) => {
    if (!selectedStep) return;

    const frameBounds = frameRef.current?.getBoundingClientRect();
    if (!frameBounds) return;

    const x = ((event.clientX - frameBounds.left) / scale / width) * 100;
    const y = ((event.clientY - frameBounds.top) / scale / height) * 100;

    if (selectedStep.type === 'pointer') {
      updateStep(selectedStep.id, {
        config: {
          x: Math.max(0, Math.min(100, Number(x.toFixed(1)))),
          y: Math.max(0, Math.min(100, Number(y.toFixed(1)))),
        },
      });
    }

    if (selectedStep.type === 'cursor-path') {
      const points = selectedStep.config?.points || [];
      updateStep(selectedStep.id, {
        config: {
          points: [...points, { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) }],
        },
      });
    }

    if (selectedStep.type === 'highlight' || selectedStep.type === 'tooltip') {
      let element = null;
      try {
        const doc = iframeRef.current?.contentDocument;
        element = doc?.elementFromPoint(
          (event.clientX - frameBounds.left) / scale,
          (event.clientY - frameBounds.top) / scale,
        );
      } catch (_error) {
        element = null;
      }

      const selector = buildCssSelector(element);
      if (selector) {
        updateStep(selectedStep.id, { selector });
      }
    }
  };

  const OverlayComponent = selectedStep ? getOverlayComponent(selectedStep.type) : null;

  return (
    <div ref={containerRef} className="h-full w-full relative">
      {!hasSnapshot ? (
        <SnapshotLoader
          onLoadUrl={(url) => {
            if (!url) return;
            updateDemo({ snapshotUrl: url, snapshotHTML: null });
          }}
          onUseHtml={(html) => {
            if (!html) return;
            updateDemo({ snapshotHTML: html, snapshotUrl: null });
          }}
          onUploadImage={(dataUrl) => {
            if (!dataUrl.startsWith('data:image/')) return;
            const safeDataUrl = dataUrl.replace(/'/g, '%27');
            updateDemo({
              snapshotHTML: `<div style=\"width:100%;height:100%;background:#09090b url('${safeDataUrl}') center/cover no-repeat\"></div>`,
              snapshotUrl: null,
            });
          }}
        />
      ) : (
        <div className="h-full w-full grid place-items-center overflow-hidden">
          <div
            ref={frameRef}
            className="relative origin-top-left"
            style={{
              width,
              height,
              transform: `scale(${scale})`,
            }}
          >
            {demo.snapshotUrl ? (
              <iframe
                ref={iframeRef}
                src={demo.snapshotUrl}
                title="Demo Snapshot"
                className="absolute inset-0 w-full h-full bg-white"
              />
            ) : (
              <iframe
                ref={iframeRef}
                title="Demo HTML Snapshot"
                srcDoc={demo.snapshotHTML || ''}
                sandbox="allow-same-origin allow-forms allow-modals allow-popups"
                className="absolute inset-0 w-full h-full bg-white"
              />
            )}

            <div className="absolute inset-0" onClick={handleOverlayClick}>
              <AnimatePresence>
                {OverlayComponent && selectedStep ? (
                  <OverlayComponent
                    key={selectedStep.id}
                    step={selectedStep}
                    isPreview={false}
                    targetRect={targetRect}
                    onAdvance={onAdvance}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
