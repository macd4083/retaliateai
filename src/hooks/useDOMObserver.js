import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSelector, captureRect } from '../utils/domSerializer';

function makeId(counterRef) {
  counterRef.current += 1;
  return `change-${Date.now()}-${counterRef.current}`;
}

/**
 * @returns {{
 *  changes: Array<Object>,
 *  isObserving: boolean,
 *  startObserving: (targetEl?: Element | null) => void,
 *  stopObserving: () => void,
 *  clearChanges: () => void
 * }}
 */
export default function useDOMObserver() {
  const [changes, setChanges] = useState([]);
  const [isObserving, setIsObserving] = useState(false);

  const mutationObserverRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const observedElementsRef = useRef(new Set());
  const lastRectsRef = useRef(new WeakMap());
  const counterRef = useRef(0);

  const addChange = useCallback((change) => {
    setChanges((prev) => [...prev, {
      id: makeId(counterRef),
      timestamp: Date.now(),
      ...change,
    }]);
  }, []);

  const observeElementForResize = useCallback((element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    if (observedElementsRef.current.has(element)) return;

    observedElementsRef.current.add(element);
    lastRectsRef.current.set(element, captureRect(element));
    resizeObserverRef.current?.observe(element);

    Array.from(element.children || []).forEach((child) => observeElementForResize(child));
  }, []);

  const startObserving = useCallback((targetEl) => {
    const root = targetEl || document.body;
    if (!root || isObserving) return;

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const target = entry.target;
        const oldRect = lastRectsRef.current.get(target) || null;
        const newRect = captureRect(target);
        lastRectsRef.current.set(target, newRect);

        if (
          oldRect
          && newRect
          && oldRect.width === newRect.width
          && oldRect.height === newRect.height
          && oldRect.top === newRect.top
          && oldRect.left === newRect.left
        ) {
          return;
        }

        addChange({
          type: 'resize',
          targetSelector: buildSelector(target),
          targetTagName: target.tagName?.toLowerCase() || 'unknown',
          oldRect,
          newRect,
        });
      });
    });

    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const mutationTarget = mutation.target?.nodeType === Node.TEXT_NODE
          ? mutation.target.parentElement
          : mutation.target;

        if (!mutationTarget) return;

        if (mutation.type === 'attributes') {
          const attributeName = mutation.attributeName || '';
          const newValue = mutationTarget.getAttribute?.(attributeName) ?? null;
          addChange({
            type: attributeName === 'style' ? 'style' : 'attribute',
            targetSelector: buildSelector(mutationTarget),
            targetTagName: mutationTarget.tagName?.toLowerCase() || 'unknown',
            attributeName,
            oldValue: mutation.oldValue,
            newValue,
            oldRect: captureRect(mutationTarget),
            newRect: captureRect(mutationTarget),
          });
        }

        if (mutation.type === 'characterData') {
          addChange({
            type: 'characterData',
            targetSelector: buildSelector(mutationTarget),
            targetTagName: mutationTarget.tagName?.toLowerCase() || 'unknown',
            oldValue: mutation.oldValue,
            newValue: mutation.target?.data || '',
          });
        }

        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              observeElementForResize(node);
            }
          });

          addChange({
            type: 'childList',
            targetSelector: buildSelector(mutationTarget),
            targetTagName: mutationTarget.tagName?.toLowerCase() || 'unknown',
            addedCount: mutation.addedNodes.length,
            removedCount: mutation.removedNodes.length,
            oldRect: captureRect(mutationTarget),
            newRect: captureRect(mutationTarget),
          });
        }
      });
    });

    resizeObserverRef.current = resizeObserver;
    mutationObserverRef.current = mutationObserver;

    observeElementForResize(root);

    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    });

    setIsObserving(true);
  }, [addChange, isObserving, observeElementForResize]);

  const stopObserving = useCallback(() => {
    mutationObserverRef.current?.disconnect();
    resizeObserverRef.current?.disconnect();
    mutationObserverRef.current = null;
    resizeObserverRef.current = null;
    observedElementsRef.current = new Set();
    lastRectsRef.current = new WeakMap();
    setIsObserving(false);
  }, []);

  const clearChanges = useCallback(() => {
    setChanges([]);
  }, []);

  useEffect(() => stopObserving, [stopObserving]);

  return {
    changes,
    isObserving,
    startObserving,
    stopObserving,
    clearChanges,
  };
}
