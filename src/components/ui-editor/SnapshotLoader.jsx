// @ts-nocheck
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUIEditorStore } from '@/store/uiEditorStore';

const APP_PAGES = [
  { name: 'Landing', route: '/' },
  { name: 'Login', route: '/login' },
  { name: 'Reflection', route: '/reflection' },
  { name: 'Insights', route: '/insights' },
  { name: 'Settings', route: '/settings' },
  { name: 'Privacy Policy', route: '/privacy' },
  { name: 'Terms of Service', route: '/terms' },
];

export default function SnapshotLoader() {
  const snapshotLoaderOpen = useUIEditorStore((state) => state.snapshotLoaderOpen);
  const setSnapshotLoaderOpen = useUIEditorStore((state) => state.setSnapshotLoaderOpen);
  const loadSnapshot = useUIEditorStore((state) => state.loadSnapshot);

  const [pastedHTML, setPastedHTML] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlHTML, setUrlHTML] = useState('');
  const [capturingPageRoute, setCapturingPageRoute] = useState('');
  const [captureError, setCaptureError] = useState('');

  const closeModal = () => setSnapshotLoaderOpen(false);

  function handleLoad(html, name) {
    if (!html || !html.trim()) return;
    loadSnapshot(html, name);
    closeModal();
  }

  function captureLiveDOM() {
    const liveDOM = document.documentElement?.outerHTML || '';
    handleLoad(liveDOM, 'Live DOM Capture');
  }

  function captureAppPage(page) {
    if (capturingPageRoute) return;

    setCaptureError('');
    setCapturingPageRoute(page.route);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '1280px';
    iframe.style.height = '800px';
    iframe.style.border = '0';

    let loadTimeoutId = null;
    let renderDelayId = null;
    let isCleanedUp = false;

    const clearTimers = () => {
      if (loadTimeoutId) window.clearTimeout(loadTimeoutId);
      if (renderDelayId) window.clearTimeout(renderDelayId);
      loadTimeoutId = null;
      renderDelayId = null;
    };

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      clearTimers();
      iframe.onload = null;
      iframe.onerror = null;
      iframe.remove();
    };

    const fail = (message) => {
      setCaptureError(message);
      setCapturingPageRoute('');
      cleanup();
    };

    iframe.onload = () => {
      renderDelayId = window.setTimeout(() => {
        try {
          const html = iframe.contentDocument?.documentElement?.outerHTML || '';
          if (!html.trim()) {
            throw new Error('No HTML captured');
          }
          loadSnapshot(html, page.name);
          closeModal();
          setCapturingPageRoute('');
          cleanup();
        } catch {
          fail(`Could not capture ${page.name}. Please try again.`);
        }
      }, 400);
    };

    iframe.onerror = () => {
      fail(`Failed to load ${page.name}. Please try again.`);
    };

    loadTimeoutId = window.setTimeout(() => {
      fail(`Loading ${page.name} timed out. Please try again.`);
    }, 10000);

    try {
      document.body.appendChild(iframe);
      iframe.src = `${window.location.origin}${page.route}`;
    } catch {
      fail(`Unable to start capture for ${page.name}.`);
    }
  }

  return (
    <Dialog open={snapshotLoaderOpen} onOpenChange={setSnapshotLoaderOpen}>
      <DialogContent className="max-w-3xl bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Load Snapshot</DialogTitle>
          <DialogDescription>
            Paste HTML, capture the current DOM, load content from a URL source, or load an app page.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="paste" className="w-full">
          <TabsList className="w-full grid grid-cols-4 bg-zinc-800">
            <TabsTrigger value="paste">Paste HTML</TabsTrigger>
            <TabsTrigger value="live">Capture Live DOM</TabsTrigger>
            <TabsTrigger value="url">Load from URL</TabsTrigger>
            <TabsTrigger value="pages">App Pages</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-3">
            <Textarea
              value={pastedHTML}
              onChange={(event) => setPastedHTML(event.target.value)}
              className="min-h-[260px] bg-zinc-950 border-zinc-700 font-mono text-xs"
              placeholder="Paste complete HTML markup..."
            />
            <div className="flex justify-end">
              <Button onClick={() => handleLoad(pastedHTML, 'Pasted HTML')} className="bg-red-600 hover:bg-red-500 text-white">
                Load
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="live" className="space-y-4">
            <p className="text-sm text-zinc-400">
              Capture <code className="text-zinc-200">document.documentElement.outerHTML</code> from this admin window.
            </p>
            <Button onClick={captureLiveDOM} className="bg-red-600 hover:bg-red-500 text-white">
              Capture and Load
            </Button>
          </TabsContent>

          <TabsContent value="url" className="space-y-3">
            <Input
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="https://example.com"
              className="bg-zinc-950 border-zinc-700"
            />
            <p className="text-xs text-zinc-500">
              CORS may block direct fetches. Enter HTML below from that page and load it manually.
            </p>
            <Textarea
              value={urlHTML}
              onChange={(event) => setUrlHTML(event.target.value)}
              className="min-h-[220px] bg-zinc-950 border-zinc-700 font-mono text-xs"
              placeholder="Enter HTML below from that page"
            />
            <div className="flex justify-end">
              <Button
                onClick={() => handleLoad(urlHTML, urlInput ? `URL: ${urlInput}` : 'URL Import')}
                className="bg-red-600 hover:bg-red-500 text-white"
              >
                Load
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="pages" className="space-y-4">
            <p className="text-sm text-zinc-400">Capture live HTML from a same-origin app route.</p>
            {captureError ? (
              <div className="rounded-md border border-red-700 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                {captureError}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {APP_PAGES.map((page) => {
                const isLoading = capturingPageRoute === page.route;
                return (
                  <Button
                    key={page.route}
                    type="button"
                    onClick={() => captureAppPage(page)}
                    disabled={Boolean(capturingPageRoute)}
                    className="justify-start bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-70"
                  >
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    <span className="truncate">{page.name}</span>
                    <span className="ml-2 text-[11px] text-zinc-400">{page.route}</span>
                  </Button>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
