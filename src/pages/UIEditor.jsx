// @ts-nocheck
import React, { useRef } from 'react';
import Toolbar from '@/components/ui-editor/Toolbar';
import EditorCanvas from '@/components/ui-editor/EditorCanvas';
import PropertiesPanel from '@/components/ui-editor/PropertiesPanel';
import SnapshotLoader from '@/components/ui-editor/SnapshotLoader';
import ImageReplaceModal from '@/components/ui-editor/ImageReplaceModal';
import ExportModal from '@/components/ui-editor/ExportModal';

export default function UIEditor() {
  const iframeRef = useRef(null);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      <Toolbar iframeRef={iframeRef} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto bg-zinc-900 p-4">
          <EditorCanvas iframeRef={iframeRef} />
        </div>
        <PropertiesPanel iframeRef={iframeRef} />
      </div>

      <SnapshotLoader />
      <ImageReplaceModal iframeRef={iframeRef} />
      <ExportModal iframeRef={iframeRef} />
    </div>
  );
}
