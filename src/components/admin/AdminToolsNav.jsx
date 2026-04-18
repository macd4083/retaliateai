import { Link } from 'react-router-dom';
import { ArrowRight, Play, Video, WandSparkles } from 'lucide-react';

const TOOLS = [
  {
    title: 'UI Editor',
    icon: WandSparkles,
    iconClass: 'text-red-400',
    description: 'Edit page UI live in the iframe',
    href: '/ui-editor',
  },
  {
    title: 'Demo Builder',
    icon: Play,
    iconClass: 'text-emerald-400',
    description: 'Record interactive product demos',
    href: '/demo-builder',
  },
  {
    title: 'Video Export',
    icon: Video,
    iconClass: 'text-blue-400',
    description: 'Export demos as MP4 / WebM / GIF',
    href: '/video-export',
  },
];

export default function AdminToolsNav() {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <WandSparkles className="w-4 h-4 text-red-400" />
        <h3 className="text-sm font-semibold text-white">Tools</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {TOOLS.map(({ title, icon: Icon, iconClass, description, href }) => (
          <article key={title} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${iconClass}`} />
              <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
            </div>
            <p className="text-sm text-zinc-400 min-h-[40px]">{description}</p>
            <Link
              to={href}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Open Tool
              <ArrowRight className="w-4 h-4" />
            </Link>
          </article>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Workflow</p>
        <p className="text-sm text-zinc-200">UI Editor → Demo Builder → Video Export</p>
        <p className="text-xs text-zinc-500 mt-1">Edit live UI · Record steps · Export as video</p>
      </div>
    </section>
  );
}
