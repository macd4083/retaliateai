// @ts-nocheck
import { create } from 'zustand';

const MAX_HISTORY = 100;

function cloneOverrides(overrides) {
  return JSON.parse(JSON.stringify(overrides || {}));
}

function withHistory(state) {
  const nextPast = [...state.past, cloneOverrides(state.nodeOverrides)];
  if (nextPast.length > MAX_HISTORY) {
    nextPast.splice(0, nextPast.length - MAX_HISTORY);
  }
  return {
    past: nextPast,
    future: [],
  };
}

export const useUIEditorStore = create((set) => ({
  rawHTML: '',
  originalHTML: '',
  activeSnapshotName: '',

  nodeOverrides: {},

  selectedNode: null,

  past: [],
  future: [],

  imageModalOpen: false,
  exportModalOpen: false,
  snapshotLoaderOpen: false,

  loadSnapshot: (html, name) =>
    set(() => ({
      rawHTML: html || '',
      originalHTML: html || '',
      activeSnapshotName: name || 'Untitled Snapshot',
      nodeOverrides: {},
      selectedNode: null,
      past: [],
      future: [],
      imageModalOpen: false,
      exportModalOpen: false,
      snapshotLoaderOpen: false,
    })),

  selectNode: (nodeData) => set(() => ({ selectedNode: nodeData || null })),

  clearSelection: () => set(() => ({ selectedNode: null })),

  applyStyle: (eid, key, value) =>
    set((state) => {
      if (!eid || !key) return state;
      const history = withHistory(state);
      const existing = state.nodeOverrides[eid] || {};
      const styles = {
        ...(existing.styles || {}),
        [key]: value,
      };

      return {
        ...history,
        nodeOverrides: {
          ...state.nodeOverrides,
          [eid]: {
            ...existing,
            styles,
          },
        },
        selectedNode:
          state.selectedNode?.eid === eid
            ? {
                ...state.selectedNode,
                styles: {
                  ...(state.selectedNode.styles || {}),
                  [key]: value,
                },
              }
            : state.selectedNode,
      };
    }),

  applyStyles: (eid, stylesObj) =>
    set((state) => {
      if (!eid || !stylesObj || typeof stylesObj !== 'object') return state;
      const history = withHistory(state);
      const existing = state.nodeOverrides[eid] || {};
      const styles = {
        ...(existing.styles || {}),
        ...stylesObj,
      };

      return {
        ...history,
        nodeOverrides: {
          ...state.nodeOverrides,
          [eid]: {
            ...existing,
            styles,
          },
        },
        selectedNode:
          state.selectedNode?.eid === eid
            ? {
                ...state.selectedNode,
                styles: {
                  ...(state.selectedNode.styles || {}),
                  ...stylesObj,
                },
              }
            : state.selectedNode,
      };
    }),

  applyText: (eid, text) =>
    set((state) => {
      if (!eid) return state;
      const history = withHistory(state);
      const existing = state.nodeOverrides[eid] || {};
      return {
        ...history,
        nodeOverrides: {
          ...state.nodeOverrides,
          [eid]: {
            ...existing,
            textContent: text,
          },
        },
        selectedNode:
          state.selectedNode?.eid === eid
            ? {
                ...state.selectedNode,
                textContent: text,
              }
            : state.selectedNode,
      };
    }),

  applyAttr: (eid, attr, value) =>
    set((state) => {
      if (!eid || !attr) return state;
      const history = withHistory(state);
      const existing = state.nodeOverrides[eid] || {};
      const attrs = {
        ...(existing.attrs || {}),
        [attr]: value,
      };

      return {
        ...history,
        nodeOverrides: {
          ...state.nodeOverrides,
          [eid]: {
            ...existing,
            attrs,
          },
        },
        selectedNode:
          state.selectedNode?.eid === eid
            ? {
                ...state.selectedNode,
                ...(attr === 'src' ? { src: value } : {}),
              }
            : state.selectedNode,
      };
    }),

  applyImageSrc: (eid, src) =>
    set((state) => {
      if (!eid) return state;
      const history = withHistory(state);
      const existing = state.nodeOverrides[eid] || {};

      return {
        ...history,
        nodeOverrides: {
          ...state.nodeOverrides,
          [eid]: {
            ...existing,
            attrs: {
              ...(existing.attrs || {}),
              src,
            },
          },
        },
        selectedNode:
          state.selectedNode?.eid === eid
            ? {
                ...state.selectedNode,
                src,
              }
            : state.selectedNode,
      };
    }),

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state;

      const previous = state.past[state.past.length - 1];
      const nextPast = state.past.slice(0, -1);
      const nextFuture = [cloneOverrides(state.nodeOverrides), ...state.future];
      if (nextFuture.length > MAX_HISTORY) {
        nextFuture.splice(MAX_HISTORY);
      }

      return {
        nodeOverrides: cloneOverrides(previous),
        past: nextPast,
        future: nextFuture,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;

      const [next, ...remainingFuture] = state.future;
      const nextPast = [...state.past, cloneOverrides(state.nodeOverrides)];
      if (nextPast.length > MAX_HISTORY) {
        nextPast.splice(0, nextPast.length - MAX_HISTORY);
      }

      return {
        nodeOverrides: cloneOverrides(next),
        past: nextPast,
        future: remainingFuture,
      };
    }),

  setImageModalOpen: (open) => set(() => ({ imageModalOpen: Boolean(open) })),
  setExportModalOpen: (open) => set(() => ({ exportModalOpen: Boolean(open) })),
  setSnapshotLoaderOpen: (open) => set(() => ({ snapshotLoaderOpen: Boolean(open) })),
}));
