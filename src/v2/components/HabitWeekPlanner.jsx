import React, { useRef } from 'react';
import { getTodayV2WeekdayDisplayOrder } from '../today/model';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const inputClass = 'w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs disabled:opacity-50';

export default function HabitWeekPlanner({ name, weekdays, times, onToggleDay, onChangeTime, disabled = false }) {
  const dragging = useRef(null);

  const place = (event, weekdayIndex) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.height) return;
    const minutes = Math.max(0, Math.min(1425, Math.round(((event.clientY - bounds.top) / bounds.height) * 1440 / 15) * 15));
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    onChangeTime(weekdayIndex, { time });
  };

  return (
    <section aria-label="Weekly habit schedule" className="space-y-2">
      <p className="text-xs text-zinc-400">Choose days with the headers. Click or drag on a day to set a time (15-minute steps), or enter an exact time below.</p>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[760px] grid-cols-7 gap-2">
          {getTodayV2WeekdayDisplayOrder().map(({ label, weekdayIndex }) => {
            const selected = weekdays.includes(weekdayIndex);
            const entry = times[weekdayIndex];
            const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time);
            const minutes = validTime ? Number(entry.time.slice(0, 2)) * 60 + Number(entry.time.slice(3)) : 0;
            const dayName = DAY_NAMES[weekdayIndex];
            return (
              <div key={weekdayIndex} className="space-y-2">
                <button
                  type="button"
                  aria-label={dayName}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onToggleDay(weekdayIndex)}
                  className={`w-full rounded border py-2 text-xs ${selected ? 'border-red-500 bg-red-600/20 text-white' : 'border-zinc-700 text-zinc-400'} disabled:opacity-50`}
                >{label}</button>
                <div
                  aria-label={`${dayName} mini timeline`}
                  data-habit-timeline={weekdayIndex}
                  className={`relative h-72 touch-none overflow-hidden rounded border border-zinc-700 ${selected && !disabled ? 'cursor-crosshair bg-zinc-950' : 'bg-zinc-800 opacity-50'}`}
                  onPointerDown={(event) => {
                    if (disabled || !selected || (event.button !== undefined && event.button !== 0)) return;
                    event.preventDefault();
                    dragging.current = { day: weekdayIndex, pointerId: event.pointerId, time: entry.time };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    place(event, weekdayIndex);
                  }}
                  onPointerMove={(event) => {
                    if (!disabled && selected && dragging.current?.day === weekdayIndex && dragging.current.pointerId === event.pointerId) place(event, weekdayIndex);
                  }}
                  onPointerUp={() => { dragging.current = null; }}
                  onPointerCancel={() => {
                    if (dragging.current?.day === weekdayIndex && !disabled) onChangeTime(weekdayIndex, { time: dragging.current.time });
                    dragging.current = null;
                  }}
                >
                  {[0, 6, 12, 18].map((hour) => (
                    <div key={hour} className="pointer-events-none absolute w-full border-t border-zinc-800 text-[10px] text-zinc-500" style={{ top: `${hour / 24 * 100}%` }}>
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  ))}
                  {selected && validTime && (
                    <div
                      className="absolute inset-x-0 rounded border border-red-400 bg-red-600/40 px-1 text-[10px] text-white"
                      style={{ top: `${minutes / 1440 * 100}%`, height: `${Math.min(Number(entry.duration_minutes) || 30, 1440 - minutes) / 1440 * 100}%`, minHeight: '4px' }}
                      title={`${name || 'Habit'} · ${entry.time} · ${entry.duration_minutes} minutes`}
                    >
                      <span className={`absolute left-0 right-0 ${minutes > 1320 ? 'bottom-0' : 'top-0'} truncate bg-red-950/90 px-1`}>
                        {entry.time} {name || 'Habit'}
                      </span>
                    </div>
                  )}
                </div>
                {selected ? (
                  <div className="space-y-2">
                    <label className="block text-xs text-zinc-400">
                      Time
                      <input aria-label={`${dayName} exact time`} type="time" step="60" disabled={disabled} value={entry.time} onChange={(event) => onChangeTime(weekdayIndex, { time: event.target.value })} className={inputClass} />
                    </label>
                    <label className="block text-xs text-zinc-400">
                      Minutes
                      <input aria-label={`${dayName} duration minutes`} type="number" min="1" max="1440" step="1" disabled={disabled} value={entry.duration_minutes} onChange={(event) => onChangeTime(weekdayIndex, { duration_minutes: event.target.value === '' ? '' : Number(event.target.value) })} className={inputClass} />
                    </label>
                    <label className="block text-xs text-zinc-400">
                      Repeated time
                      <select aria-label={`${dayName} repeated time occurrence`} disabled={disabled} value={entry.occurrence} onChange={(event) => onChangeTime(weekdayIndex, { occurrence: event.target.value })} className={inputClass}>
                        <option value="earlier">Earlier</option>
                        <option value="later">Later</option>
                      </select>
                    </label>
                  </div>
                ) : <p className="text-center text-xs text-zinc-500">Not scheduled</p>}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-zinc-500">Repeated time chooses which clock time to use when clocks go back. Durations can continue into the next day.</p>
    </section>
  );
}
