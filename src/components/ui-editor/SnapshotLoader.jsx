// @ts-nocheck
import React, { useState } from 'react';
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

export default function SnapshotLoader() {
  const snapshotLoaderOpen = useUIEditorStore((state) => state.snapshotLoaderOpen);
  const setSnapshotLoaderOpen = useUIEditorStore((state) => state.setSnapshotLoaderOpen);
  const loadSnapshot = useUIEditorStore((state) => state.loadSnapshot);

  const [pastedHTML, setPastedHTML] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlHTML, setUrlHTML] = useState('');

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

  return (
    <Dialog open={snapshotLoaderOpen} onOpenChange={setSnapshotLoaderOpen}>
      <DialogContent className="max-w-3xl bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Load Snapshot</DialogTitle>
          <DialogDescription>
            Paste HTML, capture the current DOM, or load content from a URL source.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="paste" className="w-full">
          <TabsList className="w-full grid grid-cols-3 bg-zinc-800">
            <TabsTrigger value="paste">Paste HTML</TabsTrigger>
            <TabsTrigger value="live">Capture Live DOM</TabsTrigger>
            <TabsTrigger value="url">Load from URL</TabsTrigger>
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
