// @ts-nocheck
import React, { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Box, Download, History, Redo2, Undo2 } from 'lucide-react';
import { useUIEditorStore } from '@/store/uiEditorStore';

export default function Toolbar({ iframeRef }) {
  const undo = useUIEditorStore((state) => state.undo);
  const redo = useUIEditorStore((state) => state.redo);
  const setSnapshotLoaderOpen = useUIEditorStore((state) => state.setSnapshotLoaderOpen);
  const setExportModalOpen = useUIEditorStore((state) => state.setExportModalOpen);
  const activeSnapshotName = useUIEditorStore((state) => state.activeSnapshotName);

  useEffect(() => {
    function onKeyDown(event) {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      if ((key === 'y') || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  return (
    <header className="h-12 border-b border-zinc-800 bg-zinc-950 px-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-zinc-100">
        <div className="w-7 h-7 rounded-md bg-red-500/20 border border-red-500/40 flex items-center justify-center">
          <Box className="w-4 h-4 text-red-400" />
        </div>
        <span className="text-sm font-semibold tracking-wide">UI Editor</span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={undo} className="bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800">
          <Undo2 className="w-4 h-4" />
          Undo
        </Button>
        <Button size="sm" variant="outline" onClick={redo} className="bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800">
          <Redo2 className="w-4 h-4" />
          Redo
        </Button>
        <Separator orientation="vertical" className="h-5 bg-zinc-700" />
        <Button size="sm" variant="outline" onClick={() => setSnapshotLoaderOpen(true)} className="bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800">
          <History className="w-4 h-4" />
          Load Snapshot
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            iframeRef?.current?.contentWindow?.postMessage({ type: 'CMD_RESELECT' }, '*');
            setExportModalOpen(true);
          }}
          className="bg-red-600 hover:bg-red-500 text-white"
        >
          <Download className="w-4 h-4" />
          Export
        </Button>
        <Badge className="bg-zinc-800 border border-zinc-700 text-zinc-200">
          {activeSnapshotName || 'No snapshot loaded'}
        </Badge>
      </div>
    </header>
  );
}
