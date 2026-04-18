import { useCallback, useRef, useState } from 'react';
import useDOMObserver from './useDOMObserver';
import { serializeDOM } from '../utils/domSerializer';
import { computeDiff, diffToUnifiedPatch, getDiffStats } from '../utils/diffEngine';
import { downloadJsonChangelog, downloadPatchFile } from '../utils/patchExporter';

const EMPTY_STATS = {
  additions: 0,
  deletions: 0,
  unchanged: 0,
  total: 0,
};

/**
 * @returns {{
 *  status: 'idle' | 'recording' | 'stopped',
 *  originalHTML: string,
 *  currentHTML: string,
 *  diffLines: Array<Object>,
 *  diffStats: { additions: number, deletions: number, unchanged: number, total: number },
 *  changes: Array<Object>,
 *  isObserving: boolean,
 *  startRecording: (targetEl?: Element | null) => void,
 *  stopRecording: () => void,
 *  resetRecorder: () => void,
 *  updateCurrentHTML: (html: string) => void,
 *  recomputeDiff: (nextHTML?: string) => void,
 *  exportPatch: (filename?: string) => void,
 *  exportJson: (meta?: Object, filename?: string) => void,
 *  clearChanges: () => void
 * }}
 */
export default function useRecorder() {
  const [status, setStatus] = useState('idle');
  const [originalHTML, setOriginalHTML] = useState('');
  const [currentHTML, setCurrentHTML] = useState('');
  const [diffLines, setDiffLines] = useState([]);
  const [diffStats, setDiffStats] = useState(EMPTY_STATS);

  const targetRef = useRef(null);
  const originalRef = useRef('');

  const {
    changes,
    isObserving,
    startObserving,
    stopObserving,
    clearChanges,
  } = useDOMObserver();

  const recomputeDiff = useCallback((nextHTML) => {
    const nextValue = typeof nextHTML === 'string' ? nextHTML : currentHTML;
    const nextDiff = computeDiff(originalRef.current, nextValue);
    setDiffLines(nextDiff);
    setDiffStats(getDiffStats(nextDiff));
  }, [currentHTML]);

  const startRecording = useCallback((targetEl) => {
    const root = targetEl || document.documentElement;
    targetRef.current = root;
    const snapshot = serializeDOM(root);

    originalRef.current = snapshot;
    setOriginalHTML(snapshot);
    setCurrentHTML(snapshot);
    setDiffLines([]);
    setDiffStats(EMPTY_STATS);
    clearChanges();

    startObserving(root);
    setStatus('recording');
  }, [clearChanges, startObserving]);

  const stopRecording = useCallback(() => {
    stopObserving();
    const root = targetRef.current || document.documentElement;
    const snapshot = serializeDOM(root);
    setCurrentHTML(snapshot);

    const nextDiff = computeDiff(originalRef.current, snapshot);
    setDiffLines(nextDiff);
    setDiffStats(getDiffStats(nextDiff));
    setStatus('stopped');
  }, [stopObserving]);

  const resetRecorder = useCallback(() => {
    stopObserving();
    targetRef.current = null;
    originalRef.current = '';
    setOriginalHTML('');
    setCurrentHTML('');
    setDiffLines([]);
    setDiffStats(EMPTY_STATS);
    clearChanges();
    setStatus('idle');
  }, [clearChanges, stopObserving]);

  const updateCurrentHTML = useCallback((html) => {
    setCurrentHTML(html);
    const nextDiff = computeDiff(originalRef.current, html);
    setDiffLines(nextDiff);
    setDiffStats(getDiffStats(nextDiff));
  }, []);

  const exportPatch = useCallback((filename = 'ui-recorder.patch') => {
    const patch = diffToUnifiedPatch(diffLines, 'original.html', 'modified.html', 3);
    downloadPatchFile(patch, filename);
  }, [diffLines]);

  const exportJson = useCallback((meta = {}, filename = 'ui-recorder-changelog.json') => {
    downloadJsonChangelog(changes, meta, filename);
  }, [changes]);

  return {
    status,
    originalHTML,
    currentHTML,
    diffLines,
    diffStats,
    changes,
    isObserving,
    startRecording,
    stopRecording,
    resetRecorder,
    updateCurrentHTML,
    recomputeDiff,
    exportPatch,
    exportJson,
    clearChanges,
  };
}
