import * as Progress from '@radix-ui/react-progress';

export function ExportProgressBar({ progress, status, message }) {
  const colorMap = {
    queued: 'bg-gray-400',
    capturing: 'bg-blue-500',
    processing: 'bg-purple-500',
    uploading: 'bg-yellow-500',
    cancelled: 'bg-zinc-500',
    done: 'bg-green-500',
    failed: 'bg-red-500',
  };

  const barColor = colorMap[status] || 'bg-gray-400';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-300">{message || 'Waiting...'}</span>
        <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-200 uppercase text-xs">
          {status || 'queued'}
        </span>
      </div>

      <Progress.Root className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-800 border border-zinc-700" value={progress}>
        <Progress.Indicator
          className={`h-full transition-transform duration-500 ${barColor}`}
          style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, progress || 0))}%)` }}
        />
      </Progress.Root>

      <p className="text-right text-xs text-zinc-400">{Math.round(progress || 0)}%</p>
    </div>
  );
}
