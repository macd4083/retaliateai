// @ts-nocheck
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUIEditorStore } from '@/store/uiEditorStore';
import TypographyControls from '@/components/ui-editor/panels/TypographyControls';
import LayoutControls from '@/components/ui-editor/panels/LayoutControls';
import SpacingControls from '@/components/ui-editor/panels/SpacingControls';
import StyleControls from '@/components/ui-editor/panels/StyleControls';

export default function PropertiesPanel({ iframeRef }) {
  const selectedNode = useUIEditorStore((state) => state.selectedNode);
  const applyStyleStore = useUIEditorStore((state) => state.applyStyle);
  const applyStylesStore = useUIEditorStore((state) => state.applyStyles);
  const applyAttrStore = useUIEditorStore((state) => state.applyAttr);

  function postMessage(payload) {
    iframeRef?.current?.contentWindow?.postMessage(payload, '*');
  }

  function applyStyle(key, value) {
    if (!selectedNode?.eid) return;
    applyStyleStore(selectedNode.eid, key, value);
    postMessage({ type: 'CMD_STYLE', eid: selectedNode.eid, key, value });
  }

  function applyStyles(styles) {
    if (!selectedNode?.eid) return;
    applyStylesStore(selectedNode.eid, styles);
    postMessage({ type: 'CMD_STYLES', eid: selectedNode.eid, styles });
  }

  function applyAttr(attr, value) {
    if (!selectedNode?.eid) return;
    applyAttrStore(selectedNode.eid, attr, value);
    postMessage({ type: 'CMD_ATTR', eid: selectedNode.eid, attr, value });
  }

  if (!selectedNode) {
    return (
      <aside className="w-80 border-l border-zinc-800 bg-zinc-950 p-4 text-zinc-400 flex items-center justify-center">
        <p className="text-sm">Click any element to inspect</p>
      </aside>
    );
  }

  return (
    <aside className="w-80 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">&lt;{selectedNode.tagName}&gt;</span>
          <Badge className="bg-zinc-800 border border-zinc-700 text-zinc-300">{selectedNode.eid}</Badge>
        </div>
        <p className="text-xs text-zinc-500 truncate">
          body &gt; ... &gt; &lt;{selectedNode.tagName}&gt;
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Tabs defaultValue="typography" className="w-full">
          <TabsList className="grid grid-cols-4 w-full bg-zinc-800">
            <TabsTrigger value="typography">Typography</TabsTrigger>
            <TabsTrigger value="layout">Layout</TabsTrigger>
            <TabsTrigger value="spacing">Spacing</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
          </TabsList>

          <TabsContent value="typography">
            <TypographyControls selectedNode={selectedNode} applyStyle={applyStyle} />
          </TabsContent>

          <TabsContent value="layout">
            <LayoutControls selectedNode={selectedNode} applyStyle={applyStyle} />
          </TabsContent>

          <TabsContent value="spacing">
            <SpacingControls selectedNode={selectedNode} applyStyles={applyStyles} />
          </TabsContent>

          <TabsContent value="style">
            <StyleControls selectedNode={selectedNode} applyStyle={applyStyle} applyAttr={applyAttr} />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
