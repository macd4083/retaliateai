import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { readFileSync } from 'node:fs';

const { authState, installState, supabaseMock } = vi.hoisted(() => ({
  authState: { user: null, loading: false, signOut: vi.fn() },
  installState: { isInstallable: false, isIos: false, isStandalone: false, promptInstall: vi.fn() },
  supabaseMock: { from: vi.fn(), auth: { getSession: vi.fn() } },
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../hooks/usePWAInstall', () => ({ usePWAInstall: () => installState }));
vi.mock('../lib/supabase/client', () => ({ supabase: supabaseMock }));
vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../lib/featureFlags', () => ({ ENABLE_TODAY_V2: false }));
vi.mock('../components/pwa/PWAInstallBanner', () => ({ default: () => null }));
vi.mock('../components/v2/ReflectionSummaryCard', () => ({ default: () => <div>Historical summary</div> }));

import Landing from '../pages/Landing';
import AppShellV2 from '../components/v2/AppShellV2';
import PostSessionNextSteps from '../pages/PostSessionNextSteps';
import TrialExpiredModal from '../components/TrialExpiredModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = (path) => readFileSync(`${process.cwd()}/${path}`, 'utf8');

describe('public metadata and PWA contract', () => {
  it('describes review, planning, and follow-through without a permanently free offer', () => {
    const doc = new DOMParser().parseFromString(source('index.html'), 'text/html');
    expect(doc.title).toBe('Retaliate AI - Daily Review, Plan & Follow-Through');
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      expect(doc.querySelector(selector).getAttribute('content')).toContain('follow-through');
    }
    const schema = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
    expect(schema.description).toContain('first five minutes');
    expect(schema.offers).toBeUndefined();
    expect(doc.querySelector('link[rel="canonical"]').getAttribute('href')).toBe('https://retaliateai.com/');
  });

  it('both manifests open the resolver and worker updates do not reload drafts', () => {
    const manifest = JSON.parse(source('public/site.webmanifest'));
    const config = source('vite.config.js');
    expect(manifest.start_url).toBe('/app');
    expect(manifest.scope).toBe('/');
    expect(config).toContain("start_url: '/app'");
    expect(config).toContain("registerType: 'prompt'");
    expect(config).toContain('injectRegister: null');
    expect(config).toContain('skipWaiting: false');
    expect(config).toContain('clientsClaim: false');
    expect(config).toContain("importScripts: ['/push-sw.js']");
    expect(source('src/hooks/usePWAInstall.js')).not.toMatch(/reload|updateSW|skipWaiting/);
    expect(source('public/robots.txt')).toContain('Disallow: /app');
    expect(source('public/sitemap.xml')).not.toMatch(/Journal|reflection|\/app</);
    expect(source('public/sitemap.xml')).toContain('https://retaliateai.com/privacy');
  });

  it('page shell titles match the public navigation labels', () => {
    for (const [file, title] of [
      ['src/v2/pages/HomeV2Page.jsx', 'Today'],
      ['src/v2/pages/TodayV2Page.jsx', 'Review & Plan'],
      ['src/pages/InsightsV2.jsx', 'Progress'],
    ]) {
      const titles = [...source(file).matchAll(/<AppShellV2 title="([^"]+)"/g)].map((match) => match[1]);
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.every((value) => value === title)).toBe(true);
    }
  });
});

describe('public entry and navigation', () => {
  let root;
  let container;
  let router;

  async function render(element, initialEntry = '/') {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    router = createMemoryRouter([
      { path: '/', element },
      ...['/app', '/login', '/home', '/today', '/insights', '/settings', '/admin'].map((path) => ({
        path, element: <div>{path}</div>,
      })),
    ], { initialEntries: [initialEntry] });
    await act(async () => root.render(<RouterProvider router={router} />));
  }

  async function click(text) {
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent.trim() === text);
    expect(button).toBeDefined();
    await act(async () => button.click());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
    installState.isInstallable = false;
    installState.isIos = false;
    installState.isStandalone = false;
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'user' } }) }) }),
    });
    sessionStorage.clear();
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });

  it.each([null, { id: 'guest', is_anonymous: true }])('uses signup rather than unsupported guest sessions: %s', async (user) => {
    authState.user = user;
    await render(<Landing />);
    expect(container.textContent).not.toMatch(/No sign up required|App Store|offline-ready/);
    expect(container.textContent).toContain('Measured actions and first five minutes');
    expect(container.querySelector('video')).not.toBeNull();
    await click('Start your review');
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?signup=true');
  });

  it('offers signed-in users Open app through the stable resolver', async () => {
    authState.user = { id: 'member' };
    await render(<Landing />);
    await click('Open app');
    expect(router.state.location.pathname).toBe('/app');
  });

  it.each([
    ['Today', '/home'],
    ['Review & Plan', '/today'],
    ['Progress', '/insights'],
    ['Settings', '/settings'],
  ])('keeps %s navigation on V2 even with the rollback flag false', async (label, path) => {
    authState.user = { id: 'member' };
    await render(<AppShellV2 title="Today">Content</AppShellV2>);
    const labels = [...container.querySelectorAll('nav button')].map((button) => button.textContent.trim());
    expect(labels).toEqual(['Today', 'Review & Plan', 'Progress', 'Settings']);
    await click(label);
    expect(router.state.location.pathname).toBe(path);
  });

  it('keeps administrative tools visually separate from normal navigation', async () => {
    authState.user = { id: 'admin' };
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin' } }) }) }),
    });
    await render(<AppShellV2 title="Today">Content</AppShellV2>);
    const nav = container.querySelector('nav');
    expect(nav.textContent).toContain('Administration');
    expect(nav.textContent.indexOf('Administration')).toBeGreaterThan(nav.textContent.indexOf('Settings'));
  });

  it('shows actual iOS installation instructions without leaving historical summary', async () => {
    installState.isIos = true;
    await render(<PostSessionNextSteps />, { pathname: '/', state: { summaryCardData: { summary: 'Kept my commitment' } } });
    await click('Install web app');
    expect(router.state.location.pathname).toBe('/');
    expect(container.textContent).toContain('In Safari, tap Share, then Add to Home Screen.');
    expect(container.textContent).toContain('Historical summary');
  });

  it('still offers signup when the web app is already installed', async () => {
    installState.isStandalone = true;
    await render(<PostSessionNextSteps />);
    expect(container.textContent).not.toContain('Install web app');
    await click('Start Free Trial');
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toContain('signup=true');
  });

  it('second trial expiry has an actionable checkout rather than a gated settings link', async () => {
    authState.user = { id: 'member', email: 'member@example.com' };
    await render(<TrialExpiredModal isSecondExpiry />);
    expect(container.querySelector('a[href="/settings"]')).toBeNull();
    expect(container.textContent).toContain('does not start a paid subscription');
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Review paid plan')).toBe(true);
  });
});
