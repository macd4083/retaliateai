// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useUIEditorStore } from '@/store/uiEditorStore';
import { tagHTMLElements } from '@/utils/uiEditorUtils';

let pendingExportResolver = null;

export function requestEditorHTMLExport(iframeRef) {
  return new Promise((resolve, reject) => {
    const frame = iframeRef?.current;
    if (!frame?.contentWindow) {
      reject(new Error('Editor canvas is not ready.'));
      return;
    }

    pendingExportResolver = resolve;
    frame.contentWindow.postMessage({ type: 'CMD_EXPORT_HTML' }, '*');

    setTimeout(() => {
      if (pendingExportResolver === resolve) {
        pendingExportResolver = null;
        reject(new Error('Timed out waiting for editor export.'));
      }
    }, 5000);
  });
}

export const EDITOR_INJECTION_SCRIPT = `(function() {
  let counter = 0;
  document.querySelectorAll('*').forEach(el => {
    if (!el.dataset.eid) el.dataset.eid = 'eid-' + counter++;
  });

  const style = document.createElement('style');
  style.id = '__editor_styles__';
  style.textContent = \
    '* { box-sizing: border-box; }\\n' +
    '[data-eid] { cursor: pointer; }\\n' +
    '[data-eid]:hover:not(.eid-editing) { outline: 1px dashed rgba(99,102,241,0.6) !important; }\\n' +
    '[data-eid].eid-selected { outline: 2px solid #6366f1 !important; outline-offset: 1px; }\\n' +
    '[data-eid].eid-editing { outline: 2px solid #10b981 !important; cursor: text; }\\n' +
    'a[data-eid] { pointer-events: none; }';
  document.head.appendChild(style);

  let selectedEid = null;

  function getNodeData(el) {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      eid: el.dataset.eid,
      tagName: el.tagName.toLowerCase(),
      textContent: (el.childNodes.length === 1 && el.firstChild.nodeType === 3)
        ? el.textContent.trim() : null,
      src: el.src || el.getAttribute('src') || null,
      href: el.href || el.getAttribute('href') || null,
      rect: { top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height },
      styles: {
        color: el.style.color || cs.color,
        backgroundColor: el.style.backgroundColor || cs.backgroundColor,
        fontSize: el.style.fontSize || cs.fontSize,
        fontWeight: el.style.fontWeight || cs.fontWeight,
        fontFamily: el.style.fontFamily || cs.fontFamily,
        lineHeight: el.style.lineHeight || cs.lineHeight,
        letterSpacing: el.style.letterSpacing || cs.letterSpacing,
        textAlign: el.style.textAlign || cs.textAlign,
        textDecoration: el.style.textDecoration || cs.textDecoration,
        paddingTop: el.style.paddingTop || cs.paddingTop,
        paddingRight: el.style.paddingRight || cs.paddingRight,
        paddingBottom: el.style.paddingBottom || cs.paddingBottom,
        paddingLeft: el.style.paddingLeft || cs.paddingLeft,
        marginTop: el.style.marginTop || cs.marginTop,
        marginRight: el.style.marginRight || cs.marginRight,
        marginBottom: el.style.marginBottom || cs.marginBottom,
        marginLeft: el.style.marginLeft || cs.marginLeft,
        borderRadius: el.style.borderRadius || cs.borderRadius,
        borderWidth: el.style.borderWidth || cs.borderWidth,
        borderStyle: el.style.borderStyle || cs.borderStyle,
        borderColor: el.style.borderColor || cs.borderColor,
        display: el.style.display || cs.display,
        flexDirection: el.style.flexDirection || cs.flexDirection,
        alignItems: el.style.alignItems || cs.alignItems,
        justifyContent: el.style.justifyContent || cs.justifyContent,
        gap: el.style.gap || cs.gap,
        width: el.style.width || '',
        height: el.style.height || '',
        opacity: el.style.opacity || cs.opacity,
        boxShadow: el.style.boxShadow || cs.boxShadow,
        position: el.style.position || cs.position,
        top: el.style.top || cs.top,
        left: el.style.left || cs.left,
        overflow: el.style.overflow || cs.overflow,
      },
      inlineStyle: el.getAttribute('style') || '',
      className: el.className || '',
    };
  }

  document.addEventListener('click', (e) => {
    e.preventDefault();
    const el = e.target.closest('[data-eid]');
    if (!el) return;
    document.querySelectorAll('.eid-selected').forEach(x => x.classList.remove('eid-selected'));
    el.classList.add('eid-selected');
    selectedEid = el.dataset.eid;
    window.parent.postMessage({ type: 'EDITOR_SELECT', data: getNodeData(el) }, '*');
  }, true);

  document.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-eid]');
    if (!el) return;
    const isTextNode = el.childNodes.length === 1 && el.firstChild.nodeType === 3;
    const isImg = el.tagName === 'IMG';
    if (isImg) {
      window.parent.postMessage({ type: 'EDITOR_IMAGE_CLICK', data: getNodeData(el) }, '*');
      return;
    }
    if (isTextNode) {
      el.classList.add('eid-editing');
      el.contentEditable = 'true';
      el.focus();
      const stop = () => {
        el.contentEditable = 'false';
        el.classList.remove('eid-editing');
        window.parent.postMessage({ type: 'EDITOR_TEXT_CHANGE', data: { eid: el.dataset.eid, text: el.textContent.trim() } }, '*');
      };
      el.addEventListener('blur', stop, { once: true });
      el.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter' && !ke.shiftKey) {
          ke.preventDefault();
          el.blur();
        }
      });
    }
  }, true);

  let dragging = null, dragStartMouse = null, dragStartPos = null;
  document.addEventListener('mousedown', (e) => {
    const el = e.target.closest('[data-eid]');
    if (!el || e.button !== 0) return;
    const pos = window.getComputedStyle(el).position;
    if (pos === 'absolute' || pos === 'fixed') {
      dragging = el;
      dragStartMouse = { x: e.clientX, y: e.clientY };
      dragStartPos = { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 };
      e.preventDefault();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartMouse.x;
    const dy = e.clientY - dragStartMouse.y;
    dragging.style.left = (dragStartPos.x + dx) + 'px';
    dragging.style.top = (dragStartPos.y + dy) + 'px';
    window.parent.postMessage({ type: 'EDITOR_MOVE', data: { eid: dragging.dataset.eid, left: dragging.style.left, top: dragging.style.top } }, '*');
  });
  document.addEventListener('mouseup', () => { dragging = null; });

  window.addEventListener('message', (e) => {
    const { type, eid, key, value, styles, text, attr } = e.data || {};
    const el = eid ? document.querySelector('[data-eid="' + eid + '"]') : null;
    if (type === 'CMD_STYLE' && el) { el.style[key] = value; }
    if (type === 'CMD_STYLES' && el) { Object.assign(el.style, styles); }
    if (type === 'CMD_TEXT' && el) { el.textContent = text; }
    if (type === 'CMD_ATTR' && el) { el.setAttribute(attr, value); }
    if (type === 'CMD_SRC' && el) { el.src = value; el.setAttribute('src', value); }
    if (type === 'CMD_EXPORT_HTML') {
      document.querySelectorAll('[data-eid]').forEach(x => {
        x.classList.remove('eid-selected', 'eid-editing');
      });
      const styleEl = document.getElementById('__editor_styles__');
      if (styleEl) styleEl.remove();
      window.parent.postMessage({ type: 'EDITOR_HTML_EXPORT', html: document.documentElement.outerHTML }, '*');
    }
    if (type === 'CMD_RESELECT' && selectedEid) {
      const sel = document.querySelector('[data-eid="' + selectedEid + '"]');
      if (sel) window.parent.postMessage({ type: 'EDITOR_SELECT', data: getNodeData(sel) }, '*');
    }
  });
})();`;

export default function EditorCanvas({ iframeRef }) {
  const localFrameRef = useRef(null);
  const previousOverridesRef = useRef({});
  const lastExportHTMLRef = useRef('');
  const [srcDoc, setSrcDoc] = useState('');

  const rawHTML = useUIEditorStore((state) => state.rawHTML);
  const nodeOverrides = useUIEditorStore((state) => state.nodeOverrides);
  const selectNode = useUIEditorStore((state) => state.selectNode);
  const applyText = useUIEditorStore((state) => state.applyText);
  const applyStyles = useUIEditorStore((state) => state.applyStyles);
  const setImageModalOpen = useUIEditorStore((state) => state.setImageModalOpen);
  const setSnapshotLoaderOpen = useUIEditorStore((state) => state.setSnapshotLoaderOpen);

  const combinedRef = useMemo(
    () => (node) => {
      localFrameRef.current = node;
      if (iframeRef) {
        iframeRef.current = node;
      }
    },
    [iframeRef]
  );

  useEffect(() => {
    if (!rawHTML) {
      setSrcDoc('');
      return;
    }

    const taggedHTML = tagHTMLElements(rawHTML);
    const injected = taggedHTML.includes('</body>')
      ? taggedHTML.replace('</body>', `<script>${EDITOR_INJECTION_SCRIPT}<\/script></body>`)
      : `${taggedHTML}<script>${EDITOR_INJECTION_SCRIPT}<\/script>`;

    setSrcDoc(injected);
    previousOverridesRef.current = {};
  }, [rawHTML]);

  useEffect(() => {
    function handleMessage(event) {
      const payload = event?.data;
      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'EDITOR_SELECT' && payload.data) {
        selectNode(payload.data);
      }

      if (payload.type === 'EDITOR_TEXT_CHANGE' && payload.data?.eid) {
        applyText(payload.data.eid, payload.data.text || '');
        const current = useUIEditorStore.getState().selectedNode;
        if (current?.eid === payload.data.eid) {
          selectNode({ ...current, textContent: payload.data.text || '' });
        }
      }

      if (payload.type === 'EDITOR_IMAGE_CLICK' && payload.data) {
        selectNode(payload.data);
        setImageModalOpen(true);
      }

      if (payload.type === 'EDITOR_MOVE' && payload.data?.eid) {
        applyStyles(payload.data.eid, { left: payload.data.left, top: payload.data.top });
      }

      if (payload.type === 'EDITOR_HTML_EXPORT' && typeof payload.html === 'string') {
        lastExportHTMLRef.current = payload.html;
        if (pendingExportResolver) {
          pendingExportResolver(payload.html);
          pendingExportResolver = null;
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [applyStyles, applyText, selectNode, setImageModalOpen]);

  useEffect(() => {
    const frameWindow = localFrameRef.current?.contentWindow;
    if (!frameWindow) return;

    const prev = previousOverridesRef.current;

    Object.entries(nodeOverrides || {}).forEach(([eid, override]) => {
      const changed = JSON.stringify(prev[eid] || {}) !== JSON.stringify(override || {});
      if (!changed) return;

      if (override?.styles && Object.keys(override.styles).length > 0) {
        frameWindow.postMessage({ type: 'CMD_STYLES', eid, styles: override.styles }, '*');
      }

      if (typeof override?.textContent === 'string') {
        frameWindow.postMessage({ type: 'CMD_TEXT', eid, text: override.textContent }, '*');
      }

      if (override?.attrs && typeof override.attrs === 'object') {
        Object.entries(override.attrs).forEach(([attr, value]) => {
          if (attr === 'src') {
            frameWindow.postMessage({ type: 'CMD_SRC', eid, value }, '*');
            return;
          }
          frameWindow.postMessage({ type: 'CMD_ATTR', eid, attr, value }, '*');
        });
      }
    });

    previousOverridesRef.current = JSON.parse(JSON.stringify(nodeOverrides || {}));
  }, [nodeOverrides]);

  if (!rawHTML) {
    return (
      <div className="h-full min-h-[480px] rounded-xl border border-zinc-800 bg-zinc-900/80 flex items-center justify-center">
        <button
          type="button"
          onClick={() => setSnapshotLoaderOpen(true)}
          className="group flex flex-col items-center gap-3 text-zinc-400 hover:text-white transition-colors"
        >
          <div className="w-16 h-16 rounded-2xl border border-zinc-700 bg-zinc-800 flex items-center justify-center group-hover:border-zinc-500">
            <UploadCloud className="w-8 h-8" />
          </div>
          <div className="text-center">
            <p className="font-medium">Drop HTML here or click to load</p>
            <p className="text-xs text-zinc-500 mt-1">Load a captured snapshot to begin editing</p>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[480px] rounded-xl border border-zinc-800 bg-white overflow-hidden">
      <iframe
        ref={combinedRef}
        title="UI Editor Canvas"
        srcDoc={srcDoc}
        className="w-full h-full border-0 bg-white"
      />
    </div>
  );
}
