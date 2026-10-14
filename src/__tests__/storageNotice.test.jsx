import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import StorageNotice from '../components/StorageNotice';
import { safeSetStorageItem } from '../lib/browserStorage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('storage availability notice', () => {
  it('reacts to blocked storage without throwing or promising durable local drafts', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    try {
      await act(async () => root.render(<StorageNotice />));
      await act(async () => expect(safeSetStorageItem('draft', 'value')).toBe(false));
      expect(container.textContent).toContain('Browser storage is unavailable');
      expect(container.textContent).toContain('Signed-in database saves still work');
    } finally {
      storage.mockRestore();
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
