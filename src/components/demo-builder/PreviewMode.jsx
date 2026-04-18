import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import HighlightOverlay from './overlays/HighlightOverlay';
import TooltipOverlay from './overlays/TooltipOverlay';
import ModalOverlay from './overlays/ModalOverlay';
import PointerOverlay from './overlays/PointerOverlay';
import CursorPathOverlay from './overlays/CursorPathOverlay';
import TextOverlay from './overlays/TextOverlay';

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

export default function PreviewMode({
  demo,
  steps,
  currentStepIndex,
  setCurrentStepIndex,
  setIsPreviewMode,
}) {
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef(Date.now());

  const selectedStep = steps[currentStepIndex] || null;
  const OverlayComponent = selectedStep ? getOverlayComponent(selectedStep.type) : null;

  const totalMs = useMemo(
    () => steps.reduce((sum, step) => sum + step.delay + step.duration, 0),
    [steps],
  );

  useEffect(() => {
    startedAtRef.current = Date.now();
    setElapsed(0);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 100);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedStep) return undefined;
    if (selectedStep.advance === 'click') return undefined;

    const timeout = window.setTimeout(() => {
      if (currentStepIndex >= steps.length - 1) {
        setIsPreviewMode(false);
        return;
      }
      setCurrentStepIndex(currentStepIndex + 1);
    }, selectedStep.delay + selectedStep.duration);

    return () => window.clearTimeout(timeout);
  }, [currentStepIndex, selectedStep, setCurrentStepIndex, setIsPreviewMode, steps.length]);

  const progress = totalMs > 0 ? Math.min(100, (elapsed / totalMs) * 100) : 0;

  const handleAdvance = () => {
    if (!selectedStep) return;

    if (selectedStep.type === 'modal') {
      const action = selectedStep.config?.ctaAction;
      if (action === 'url' && selectedStep.config?.ctaUrl) {
        window.open(selectedStep.config.ctaUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      if (action === 'close') {
        setIsPreviewMode(false);
        return;
      }
    }

    if (currentStepIndex >= steps.length - 1) {
      setIsPreviewMode(false);
      return;
    }

    setCurrentStepIndex(currentStepIndex + 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black/90"
    >
      <button
        onClick={() => setIsPreviewMode(false)}
        className="absolute top-4 left-4 p-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white z-10"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 z-10">
        {Math.min(currentStepIndex + 1, steps.length)} / {steps.length}
      </div>

      <div className="h-full w-full grid place-items-center p-6">
        <div className="relative w-full h-full max-w-[1400px] max-h-[860px] border border-zinc-700 rounded-xl bg-zinc-950 overflow-hidden">
          {demo.snapshotUrl ? (
            <iframe title="Preview Snapshot" src={demo.snapshotUrl} className="absolute inset-0 w-full h-full bg-white" />
          ) : (
            <iframe
              title="Preview HTML Snapshot"
              srcDoc={demo.snapshotHTML || ''}
              sandbox="allow-same-origin allow-forms allow-modals allow-popups"
              className="absolute inset-0 w-full h-full bg-white"
            />
          )}

          <AnimatePresence>
            {OverlayComponent && selectedStep ? (
              <OverlayComponent key={selectedStep.id} step={selectedStep} isPreview onAdvance={handleAdvance} />
            ) : null}
          </AnimatePresence>

          {selectedStep?.advance === 'click' && (
            <button
              onClick={handleAdvance}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-red-600 border border-red-700 text-white text-sm hover:bg-red-500"
            >
              Click to continue →
            </button>
          )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 h-1 bg-red-600" style={{ width: `${progress}%` }} />
    </motion.div>
  );
}
