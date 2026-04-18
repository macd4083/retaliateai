import { create } from 'zustand';

export const useAdminToolsStore = create((set) => ({
  pendingSnapshotHtml: null,
  setPendingSnapshotHtml: (html) => set({ pendingSnapshotHtml: html }),
  clearPendingSnapshotHtml: () => set({ pendingSnapshotHtml: null }),

  pendingDemoUrl: null,
  setPendingDemoUrl: (url) => set({ pendingDemoUrl: url }),
  clearPendingDemoUrl: () => set({ pendingDemoUrl: null }),
}));
