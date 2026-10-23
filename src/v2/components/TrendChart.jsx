import React from 'react';

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrendChart({ title, description, points, min = 0, max = 100, unit = '%', controls }) {
  const [activeDate, setActiveDate] = React.useState(null);
  const [showValues, setShowValues] = React.useState(false);
  const latest = points.findLast((point) => point.value != null);
  const activeIndex = points.findIndex((point) => point.date === activeDate);
  const active = activeIndex >= 0 ? points[activeIndex] : latest;
  const width = 640;
  const height = 164;
  const pad = 8;
  const x = (index) => pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (value) => height - pad - ((value - min) / (max - min)) * (height - pad * 2);
  let connected = false;
  const path = points.map((point, index) => {
    if (point.value == null) { connected = false; return ''; }
    const command = connected ? 'L' : 'M';
    connected = true;
    return `${command}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`;
  }).join(' ');
  const valueLabel = (value) => value == null ? 'No entry' : `${Number(value.toFixed(1))}${unit}`;
  const selectAtPointer = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !points.length) return;
    const fraction = ((event.clientX - bounds.left) / bounds.width * width - pad) / (width - 2 * pad);
    const index = Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1))));
    setActiveDate(points[index].date);
  };
  const moveSelection = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !points.length) return;
    event.preventDefault();
    const current = activeIndex >= 0 ? activeIndex : Math.max(0, points.findIndex((point) => point === latest));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
    setActiveDate(points[index].date);
  };
  const selectedIndex = active ? points.indexOf(active) : -1;

  return (
    <section aria-label={title} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
          <p className="mt-1 max-w-sm text-xs text-zinc-500">{description}</p>
          <p className="mt-2 text-2xl font-medium tabular-nums tracking-tight text-white">{active ? valueLabel(active.value) : '—'}</p>
          <p className="mt-1 min-h-4 text-xs text-zinc-500" aria-live="polite">{active ? formatDate(active.date) : 'No entries yet'}</p>
        </div>
        {controls}
      </div>
      <div className="relative mt-5">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${title}. ${description} Use left and right arrows to explore daily values.`}
          tabIndex={0} onKeyDown={moveSelection} onPointerMove={selectAtPointer} onPointerDown={selectAtPointer} onPointerLeave={() => setActiveDate(null)}
          onBlur={() => setActiveDate(null)} className="h-40 w-full rounded outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
          {[min, (min + max) / 2, max].map((value) => (
            <line key={value} x1={pad} x2={width - pad} y1={y(value)} y2={y(value)} stroke="#3f3f46" strokeOpacity={0.45} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          ))}
          <path data-trend-line d={path} fill="none" stroke="#f87171" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {points.map((point, index) => point.value != null && (index === 0 || points[index - 1].value == null) && (index === points.length - 1 || points[index + 1].value == null)
            ? <circle key={point.date} cx={x(index)} cy={y(point.value)} r="2" fill="#f87171" /> : null)}
          {active && activeDate && <>
            <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={pad} y2={height - pad} stroke="#71717a" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            {active.value != null && <circle cx={x(selectedIndex)} cy={y(active.value)} r="3" fill="#f87171" />}
          </>}
        </svg>
        {!latest && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-500">No entries in this period yet.</p>}
      </div>
      {points.length > 0 && <div className="mt-2 flex justify-between text-[10px] text-zinc-500"><span>{formatDate(points[0].date)}</span><span>{formatDate(points[points.length - 1].date)}</span></div>}
      <details onToggle={(event) => setShowValues(event.currentTarget.open)} className="mt-3 text-xs text-zinc-500">
        <summary className="w-fit cursor-pointer hover:text-zinc-300">View daily values</summary>
        <div className="mt-2 max-h-40 overflow-y-auto">
          {showValues && <table className="w-full text-left"><caption className="sr-only">{title}</caption><thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
            <tbody>{points.map((point) => <tr key={point.date}><th scope="row" className="py-1 font-normal">{formatDate(point.date)}</th><td>{valueLabel(point.value)}</td></tr>)}</tbody>
          </table>}
        </div>
      </details>
    </section>
  );
}
