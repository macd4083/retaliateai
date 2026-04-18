import React, { useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { generateEmbedScript, generateJSON, generateStandaloneHTML } from '../../utils/embedGenerator';

function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function EmbedPanel({ demo, onClose }) {
  const [tab, setTab] = useState('json');
  const [options, setOptions] = useState({ autoplay: true, trigger: '', position: 'center' });
  const [copyStatus, setCopyStatus] = useState('');

  const jsonOutput = useMemo(() => generateJSON(demo), [demo]);
  const scriptOutput = useMemo(() => generateEmbedScript(demo, options), [demo, options]);
  const htmlOutput = useMemo(() => generateStandaloneHTML(demo), [demo]);

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('Copied to clipboard');
      window.setTimeout(() => setCopyStatus(''), 1800);
    } catch (_error) {
      setCopyStatus('Copy failed');
      window.setTimeout(() => setCopyStatus(''), 1800);
    }
  };

  return (
    <div className="absolute top-0 right-0 h-full w-[540px] border-l border-zinc-800 bg-zinc-950 z-40 shadow-2xl">
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Embed Export</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-zinc-800 flex gap-2">
          {[
            { id: 'json', label: 'JSON Schema' },
            { id: 'script', label: 'Embed Script' },
            { id: 'html', label: 'Standalone HTML' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                tab === item.id
                  ? 'bg-red-600 border-red-700 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {copyStatus ? <p className="text-xs text-zinc-400">{copyStatus}</p> : null}
          {tab === 'json' && (
            <>
              <textarea readOnly value={jsonOutput} className="w-full h-[460px] rounded-xl bg-zinc-900 border border-zinc-700 p-3 text-xs text-zinc-200 font-mono" />
              <div className="flex gap-2">
                <button onClick={() => copyText(jsonOutput)} className="px-3 py-2 rounded-lg bg-red-600 border border-red-700 text-white text-sm">Copy JSON</button>
                <button onClick={() => downloadFile('demo.json', jsonOutput)} className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm flex items-center gap-1.5">
                  <Download className="w-4 h-4" />
                  Download demo.json
                </button>
              </div>
            </>
          )}

          {tab === 'script' && (
            <>
              <div className="grid grid-cols-1 gap-3">
                <label className="text-xs text-zinc-400 space-y-1 block">
                  <span>Autoplay</span>
                  <button
                    onClick={() => setOptions((prev) => ({ ...prev, autoplay: !prev.autoplay }))}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${
                      options.autoplay
                        ? 'bg-red-600 border-red-700 text-white'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-300'
                    }`}
                  >
                    {options.autoplay ? 'Enabled' : 'Disabled'}
                  </button>
                </label>
                <label className="text-xs text-zinc-400 space-y-1 block">
                  <span>Manual trigger CSS selector</span>
                  <input
                    value={options.trigger}
                    onChange={(event) => setOptions((prev) => ({ ...prev, trigger: event.target.value }))}
                    placeholder="#launch-demo"
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-400 space-y-1 block">
                  <span>Position</span>
                  <select
                    value={options.position}
                    onChange={(event) => setOptions((prev) => ({ ...prev, position: event.target.value }))}
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
                  >
                    <option value="center">center</option>
                    <option value="bottom-right">bottom-right</option>
                    <option value="bottom-left">bottom-left</option>
                  </select>
                </label>
              </div>
              <textarea readOnly value={scriptOutput} className="w-full h-[340px] rounded-xl bg-zinc-900 border border-zinc-700 p-3 text-xs text-zinc-200 font-mono" />
              <button onClick={() => copyText(scriptOutput)} className="px-3 py-2 rounded-lg bg-red-600 border border-red-700 text-white text-sm">Copy Script</button>
            </>
          )}

          {tab === 'html' && (
            <>
              <textarea readOnly value={htmlOutput} className="w-full h-[460px] rounded-xl bg-zinc-900 border border-zinc-700 p-3 text-xs text-zinc-200 font-mono" />
              <div className="flex gap-2">
                <button onClick={() => downloadFile('demo.html', htmlOutput, 'text/html')} className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm flex items-center gap-1.5">
                  <Download className="w-4 h-4" />
                  Download demo.html
                </button>
                <button onClick={() => copyText(htmlOutput)} className="px-3 py-2 rounded-lg bg-red-600 border border-red-700 text-white text-sm">Copy HTML</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
