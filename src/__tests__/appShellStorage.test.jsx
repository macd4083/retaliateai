import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/home' }),
}));
vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin', email: 'admin@example.test' }, signOut: vi.fn() }),
}));
vi.mock('../lib/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { role: 'admin' } }),
  }) }) }) },
}));
vi.mock('../hooks/usePWAInstall', () => ({
  usePWAInstall: () => ({ isInstallable: false }),
}));
vi.mock('../components/pwa/PWAInstallBanner', () => ({ default: () => null }));

import AppShellV2 from '../components/v2/AppShellV2';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AppShell storage resilience', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders when storage access is denied and tolerates both admin override buttons', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<AppShellV2 title="Today"><p>Content available</p></AppShellV2>);
      });
      expect(container.textContent).toContain('Content available');
      const buttons = [...container.querySelectorAll('button')];
      await act(async () => {
        buttons.find((button) => button.textContent.includes('Afternoon')).click();
        buttons.find((button) => button.textContent.includes('Real time')).click();
      });
      expect(container.textContent).toContain('Content available');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
