import React, { useState } from 'react';
import { Globe, ImageUp, Code2 } from 'lucide-react';

export default function SnapshotLoader({ onLoadUrl, onUseHtml, onUploadImage }) {
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');

  const handleUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUploadImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-3xl grid md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-white font-medium text-sm">
            <Globe className="w-4 h-4 text-red-500" />
            Load URL
          </div>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://app.retaliateai.com"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-red-600"
          />
          <button
            onClick={() => onLoadUrl(url)}
            className="w-full px-3 py-2 rounded-lg bg-red-600 border border-red-700 text-white text-sm font-medium hover:bg-red-500 transition-colors"
          >
            Load URL
          </button>
          <p className="text-xs text-zinc-500">
            Cross-origin URLs may not be fully interactive due to browser security. Best used with same-origin pages.
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-white font-medium text-sm">
            <Code2 className="w-4 h-4 text-red-500" />
            Paste HTML
          </div>
          <textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            placeholder="<html>...</html>"
            className="w-full h-28 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-red-600"
          />
          <button
            onClick={() => onUseHtml(html)}
            className="w-full px-3 py-2 rounded-lg bg-red-600 border border-red-700 text-white text-sm font-medium hover:bg-red-500 transition-colors"
          >
            Use HTML
          </button>
          <label className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer">
            <ImageUp className="w-4 h-4" />
            Upload Screenshot
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleUpload} />
          </label>
        </div>
      </div>
    </div>
  );
}
