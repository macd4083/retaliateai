// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useUIEditorStore } from '@/store/uiEditorStore';
import { computeHTMLDiff, exportHTMLWithStyles } from '@/utils/uiEditorUtils';
import { requestEditorHTMLExport } from '@/components/ui-editor/EditorCanvas';

function copyText(value) {
  navigator.clipboard?.writeText(value || '');
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function colorizeHTML(html) {
  const escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/(&lt;\/?)([a-zA-Z0-9-]+)/g, '$1<span class="text-rose-300">$2</span>')
    .replace(/([a-zA-Z-:]+)=(&quot;.*?&quot;|".*?")/g, '<span class="text-sky-300">$1</span>=<span class="text-amber-200">$2</span>');
}

export default function ExportModal({ iframeRef }) {
  const exportModalOpen = useUIEditorStore((state) => state.exportModalOpen);
  const setExportModalOpen = useUIEditorStore((state) => state.setExportModalOpen);
  const rawHTML = useUIEditorStore((state) => state.rawHTML);
  const originalHTML = useUIEditorStore((state) => state.originalHTML);
  const nodeOverrides = useUIEditorStore((state) => state.nodeOverrides);

  const [activeTab, setActiveTab] = useState('html');
  const [exportPayload, setExportPayload] = useState({
    html: '',
    cssBlock: '',
    diff: '',
  });

  useEffect(() => {
    let mounted = true;

    async function generate() {
      if (!exportModalOpen) return;

      let liveHTML = '';
      try {
        liveHTML = await requestEditorHTMLExport(iframeRef);
      } catch {
        liveHTML = '';
      }

      const generated = exportHTMLWithStyles(rawHTML, nodeOverrides);
      const finalHTML = liveHTML || generated.html;
      const finalDiff = computeHTMLDiff(originalHTML || rawHTML, finalHTML);

      if (!mounted) return;
      setExportPayload({
        html: finalHTML,
        cssBlock: generated.cssBlock,
        diff: finalDiff,
      });
    }

    generate();

    return () => {
      mounted = false;
    };
  }, [exportModalOpen, iframeRef, nodeOverrides, originalHTML, rawHTML]);

  const htmlWithColors = useMemo(() => colorizeHTML(exportPayload.html || ''), [exportPayload.html]);
  const diffLines = useMemo(() => (exportPayload.diff || '').split('\n'), [exportPayload.diff]);

  return (
    <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
      <DialogContent className="max-w-5xl bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Export Updated UI</DialogTitle>
          <DialogDescription>Review the generated HTML, CSS block, and diff output.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 bg-zinc-800">
            <TabsTrigger value="html">Updated HTML</TabsTrigger>
            <TabsTrigger value="css">CSS Block</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
          </TabsList>

          <TabsContent value="html" className="space-y-3">
            <div className="max-h-[420px] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs leading-5 font-mono">
              <pre dangerouslySetInnerHTML={{ __html: htmlWithColors }} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="bg-zinc-900 border-zinc-700" onClick={() => copyText(exportPayload.html)}>
                Copy HTML
              </Button>
              <Button className="bg-red-600 hover:bg-red-500 text-white" onClick={() => downloadFile('updated-ui.html', exportPayload.html)}>
                Download HTML
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="css" className="space-y-3">
            <pre className="max-h-[420px] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs leading-5 font-mono text-emerald-200">
              {exportPayload.cssBlock}
            </pre>
            <div className="flex justify-end">
              <Button variant="outline" className="bg-zinc-900 border-zinc-700" onClick={() => copyText(exportPayload.cssBlock)}>
                Copy CSS
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="diff" className="space-y-3">
            <div className="max-h-[420px] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs leading-5 font-mono">
              {diffLines.map((line, index) => {
                const bg = line.startsWith('+')
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : line.startsWith('-')
                    ? 'bg-red-500/15 text-red-200'
                    : 'text-zinc-300';

                return (
                  <div key={`${line}-${index}`} className={`grid grid-cols-[48px_1fr] ${bg}`}>
                    <span className="text-zinc-500 pr-2">{index + 1}</span>
                    <span>{line || ' '}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" className="bg-zinc-900 border-zinc-700" onClick={() => copyText(exportPayload.diff)}>
                Copy Diff
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
