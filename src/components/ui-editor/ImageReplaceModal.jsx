// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUIEditorStore } from '@/store/uiEditorStore';

function sanitizeImageSrc(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  if (candidate.startsWith('data:image/')) return candidate;
  if (candidate.startsWith('blob:')) return candidate;
  if (candidate.startsWith('/')) return candidate;

  try {
    const parsed = new URL(candidate, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }

  return '';
}

export default function ImageReplaceModal({ iframeRef }) {
  const selectedNode = useUIEditorStore((state) => state.selectedNode);
  const imageModalOpen = useUIEditorStore((state) => state.imageModalOpen);
  const setImageModalOpen = useUIEditorStore((state) => state.setImageModalOpen);
  const applyImageSrc = useUIEditorStore((state) => state.applyImageSrc);

  const [urlValue, setUrlValue] = useState('');
  const [previewSrc, setPreviewSrc] = useState('');
  const [renderPreviewSrc, setRenderPreviewSrc] = useState('');

  function postSrc(src) {
    const safeSrc = sanitizeImageSrc(src);
    if (!selectedNode?.eid || !safeSrc) return;
    applyImageSrc(selectedNode.eid, safeSrc);
    iframeRef?.current?.contentWindow?.postMessage({ type: 'CMD_SRC', eid: selectedNode.eid, value: safeSrc }, '*');
    setImageModalOpen(false);
  }

  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPreviewSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  const currentSrc = sanitizeImageSrc(previewSrc || urlValue || selectedNode?.src || '');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    async function loadPreview() {
      if (!currentSrc) {
        setRenderPreviewSrc('');
        return;
      }

      if (currentSrc.startsWith('data:image/') || currentSrc.startsWith('blob:')) {
        setRenderPreviewSrc(currentSrc);
        return;
      }

      try {
        const response = await fetch(currentSrc);
        if (!response.ok) throw new Error('Preview fetch failed');
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setRenderPreviewSrc(objectUrl);
        }
      } catch {
        if (!cancelled) {
          setRenderPreviewSrc('');
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [currentSrc]);

  return (
    <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
      <DialogContent className="max-w-2xl bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Replace Image</DialogTitle>
          <DialogDescription>Set a new image URL or upload a local image file.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
          {renderPreviewSrc ? (
            <div
              role="img"
              aria-label="Current preview"
              className="h-64 w-full rounded bg-center bg-contain bg-no-repeat"
              style={{ backgroundImage: `url(\"${renderPreviewSrc}\")` }}
            />
          ) : (
            <div className="h-40 flex items-center justify-center text-sm text-zinc-500">No preview available</div>
          )}
        </div>

        <Tabs defaultValue="url" className="w-full">
          <TabsList className="grid grid-cols-2 bg-zinc-800">
            <TabsTrigger value="url">URL</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="space-y-2">
            <Input
              value={urlValue}
              onChange={(event) => {
                setUrlValue(event.target.value);
                setPreviewSrc('');
              }}
              className="bg-zinc-950 border-zinc-700"
              placeholder="https://images.example.com/image.jpg"
            />
            <Button variant="outline" className="bg-zinc-900 border-zinc-700" onClick={() => setPreviewSrc(urlValue)}>
              Preview
            </Button>
          </TabsContent>

          <TabsContent value="upload" className="space-y-2">
            <Input type="file" accept="image/*" onChange={onFileChange} className="bg-zinc-950 border-zinc-700" />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end">
          <Button onClick={() => postSrc(currentSrc)} className="bg-red-600 hover:bg-red-500 text-white" disabled={!currentSrc}>
            Replace Image
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
