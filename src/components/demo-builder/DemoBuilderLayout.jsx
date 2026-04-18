import React from 'react';

export default function DemoBuilderLayout({ left, center, right, bottom }) {
  return (
    <div className="h-full grid grid-rows-[1fr_160px] gap-3">
      <div className="grid grid-cols-[240px_1fr_320px] gap-3 min-h-0">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl min-h-0 overflow-hidden">{left}</div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl min-h-0 overflow-hidden">{center}</div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl min-h-0 overflow-hidden">{right}</div>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">{bottom}</div>
    </div>
  );
}
