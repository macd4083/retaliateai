// @ts-nocheck
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Toolbar from '@/components/ui-editor/Toolbar';
import { requestEditorHTMLExport } from '@/components/ui-editor/EditorCanvas';
import EditorCanvas from '@/components/ui-editor/EditorCanvas';
import PropertiesPanel from '@/components/ui-editor/PropertiesPanel';
import SnapshotLoader from '@/components/ui-editor/SnapshotLoader';
import ImageReplaceModal from '@/components/ui-editor/ImageReplaceModal';
import ExportModal from '@/components/ui-editor/ExportModal';
import { useUIEditorStore } from '@/store/uiEditorStore';
import { useAdminToolsStore } from '@/store/adminToolsStore';

export default function UIEditor() {
  const iframeRef = useRef(null);
  const navigate = useNavigate();
  const rawHTML = useUIEditorStore((state) => state.rawHTML);
  const setPendingSnapshotHtml = useAdminToolsStore((state) => state.setPendingSnapshotHtml);
  const [isSending, setIsSending] = useState(false);
  const [handoffMsg, setHandoffMsg] = useState('');
  const hasLoadedPage = useMemo(() => Boolean(rawHTML && rawHTML.trim()), [rawHTML]);

  const handleOpenInDemoBuilder = async () => {
    if (!hasLoadedPage || isSending) return;
    setIsSending(true);
    setHandoffMsg('');
    try {
      const html = await requestEditorHTMLExport(iframeRef);
      setPendingSnapshotHtml(html);
      navigate('/demo-builder');
    } catch (_error) {
      setHandoffMsg('Unable to export HTML from the editor. Try again.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      <Toolbar iframeRef={iframeRef} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto bg-zinc-900 p-4">
          <EditorCanvas iframeRef={iframeRef} />
        </div>
        <PropertiesPanel iframeRef={iframeRef} />
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-400">
          {hasLoadedPage
            ? 'Ready to hand off this edited snapshot to Demo Builder.'
            : 'Load a snapshot to enable handoff to Demo Builder.'}
        </p>
        <button
          type="button"
          onClick={handleOpenInDemoBuilder}
          disabled={!hasLoadedPage || isSending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{isSending ? 'Opening…' : 'Open in Demo Builder'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      {handoffMsg ? <div className="px-4 pb-3 text-xs text-amber-400">{handoffMsg}</div> : null}

      <SnapshotLoader />
      <ImageReplaceModal iframeRef={iframeRef} />
      <ExportModal iframeRef={iframeRef} />
    </div>
  );
}
