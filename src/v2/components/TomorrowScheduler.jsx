import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import GoogleCalendarConnection from './GoogleCalendarConnection';
import { layoutScheduleBlocks, zonedLocalTimeToTimestamp } from '../today/scheduling';

const fieldClass = 'w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white';
const buttonClass = 'rounded-lg border border-zinc-600 px-3 py-2 text-sm hover:border-zinc-400 disabled:opacity-50';
const itemKey = (item) => item.key || item.item_key || item.id;
const blockKey = (block) => block.source_key || block.item_key || block.key;

class MousePenPointerSensor extends PointerSensor {
  static activators = PointerSensor.activators.map((activator) => ({
    ...activator,
    handler: (event, ...args) => event.nativeEvent.pointerType !== 'touch' && activator.handler(event, ...args),
  }));
}

function resolveScheduleTime(localDate, time, timezone, occurrence, duration) {
  if (!Number.isInteger(duration) || duration < 15 || duration > 1440 || duration % 15 !== 0) throw new Error('Choose a duration in 15-minute steps, up to 24 hours.');
  const starts_at = zonedLocalTimeToTimestamp(localDate, time, timezone, occurrence);
  const earlier = zonedLocalTimeToTimestamp(localDate, time, timezone, 'earlier');
  const later = zonedLocalTimeToTimestamp(localDate, time, timezone, 'later');
  return { starts_at, ends_at: new Date(Date.parse(starts_at) + duration * 60000).toISOString(), ambiguous: earlier !== later };
}

function localParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, minutes: Number(map.hour) * 60 + Number(map.minute) };
}

function Slot({ minute, disabled }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${minute}`, data: { minute }, disabled });
  return <div ref={setNodeRef} aria-hidden="true" className={`h-9 border-t ${minute % 60 === 0 ? 'border-zinc-600/60' : 'border-zinc-800/60'} ${isOver ? 'bg-red-500/25' : ''}`} />;
}

function DraggableItem({ item, onEdit, disabled, style, children }) {
  const key = itemKey(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: key, data: { item }, disabled });
  return (
    <div ref={setNodeRef} style={style} className={`flex gap-1 rounded-lg border ${item.type === 'habit' ? 'border-emerald-700/70 bg-emerald-950/40' : 'border-red-800/60 bg-zinc-900'} p-2 text-xs ${isDragging ? 'opacity-40' : ''}`}>
      {!disabled && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag ${item.label}; press Enter to edit time`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(item); } }} style={{ touchAction: 'none' }} className="shrink-0 rounded px-1 text-zinc-400 hover:text-white">⠿</button>}
      <button type="button" disabled={disabled} onClick={() => onEdit(item)} className="min-w-0 flex-1 text-left text-zinc-100">
        <span className="block break-words font-medium">{item.label}</span>
        {children}
        <span className={`mt-1 block text-[10px] ${item.type === 'habit' ? 'text-emerald-300' : 'text-red-300'}`}>{item.type === 'habit' ? '↻ Habit' : '◆ Commitment'}{!disabled && ' · Edit time'}</span>
      </button>
    </div>
  );
}

export default function TomorrowScheduler({
  userId, localDate, timezone = 'UTC', items = [], blocks = [], available = true, readOnly = false,
  saveStatus, saveError, onUpdate, onUnschedule, onRetry, resolveTime = resolveScheduleTime,
}) {
  const sensors = useSensors(useSensor(MousePenPointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }));
  const [active, setActive] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [time, setTime] = React.useState('09:00');
  const [duration, setDuration] = React.useState(30);
  const [occurrence, setOccurrence] = React.useState('earlier');
  const [confirmOverlap, setConfirmOverlap] = React.useState(false);
  const [dialogError, setDialogError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [googleEvents, setGoogleEvents] = React.useState([]);
  const timeline = React.useRef(null);
  const focusReturn = React.useRef(null);
  const scheduledKeys = new Set(blocks.map(blockKey));
  const unscheduled = items.filter((item) => !scheduledKeys.has(itemKey(item)));
  const itemMap = new Map(items.map((item) => [itemKey(item), item]));
  const sortedBlocks = [...blocks].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const visualLayout = (entries) => layoutScheduleBlocks(entries.map((entry) => {
    const start = localParts(entry.starts_at, timezone);
    const end = localParts(entry.ends_at, timezone);
    const first = start.date < localDate ? 0 : start.minutes;
    const last = end.date > localDate ? 1440 : Math.max(first + 15, end.minutes);
    // Repeated DST wall times need separate visual lanes even when their instants do not overlap.
    return { original: entry, starts_at: new Date(first * 60000).toISOString(), ends_at: new Date(last * 60000).toISOString() };
  })).map(({ original, lane }) => ({ ...original, lane }));
  const localLanes = visualLayout(sortedBlocks);
  const laneCount = Math.max(1, ...localLanes.map((block) => block.lane + 1));
  const timedGoogle = googleEvents.filter((event) => !event.all_day && !event.allDay && !(event.start?.date)).map((event) => ({
    ...event, starts_at: event.starts_at || event.start?.dateTime || event.start, ends_at: event.ends_at || event.end?.dateTime || event.end,
  })).filter((event) => event.starts_at && event.ends_at).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const googleLanes = visualLayout(timedGoogle);
  const googleLaneCount = Math.max(1, ...googleLanes.map((block) => block.lane + 1));
  const allDay = googleEvents.filter((event) => event.all_day || event.allDay || event.start?.date);

  React.useEffect(() => { if (timeline.current) timeline.current.scrollTop = 8 * 144; }, [localDate, available]);

  const edit = (item, minute) => {
    focusReturn.current = document.activeElement;
    const existing = blocks.find((block) => blockKey(block) === itemKey(item));
    setTime(minute !== undefined ? `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` : existing ? localParts(existing.starts_at, timezone).time : '09:00');
    setDuration(existing ? Math.max(15, Math.round((new Date(existing.ends_at) - new Date(existing.starts_at)) / 60000)) : 30);
    const existingTime = existing && localParts(existing.starts_at, timezone).time;
    setOccurrence(existing && minute === undefined && Date.parse(existing.starts_at) === Date.parse(zonedLocalTimeToTimestamp(localDate, existingTime, timezone, 'later')) ? 'later' : 'earlier');
    setConfirmOverlap(false);
    setDialogError('');
    setEditing(item);
  };

  let proposal = null;
  let timeError = '';
  try {
    if (editing && resolveTime) proposal = resolveTime(localDate, time, timezone, occurrence, Number(duration));
  } catch (failure) { timeError = failure.message; }
  const busyAllDay = allDay.filter((event) => event.transparency !== 'transparent' && (event.start?.date || event.start || event.starts_at) <= localDate && (event.end?.date || event.end || event.ends_at) > localDate).map((event) => ({
    starts_at: '0001-01-01T00:00:00Z', ends_at: '9999-12-31T00:00:00Z',
  }));
  const conflictBlocks = [...blocks, ...timedGoogle.filter((event) => event.transparency !== 'transparent'), ...busyAllDay];
  const overlaps = proposal?.starts_at ? conflictBlocks.filter((block) => blockKey(block) !== itemKey(editing) && new Date(block.starts_at) < new Date(proposal.ends_at) && new Date(block.ends_at) > new Date(proposal.starts_at)) : [];

  const commit = async (item, next, explicitOverlap = false) => {
    const collisions = conflictBlocks.some((block) => blockKey(block) !== itemKey(item) && new Date(block.starts_at) < new Date(next.ends_at) && new Date(block.ends_at) > new Date(next.starts_at));
    if (collisions && !explicitOverlap) return false;
    await onUpdate(itemKey(item), { starts_at: next.starts_at, ends_at: next.ends_at });
    return true;
  };

  const save = async (event) => {
    event.preventDefault();
    if (!proposal || timeError || (overlaps.length && !confirmOverlap)) return;
    setSaving(true);
    setDialogError('');
    try {
      await commit(editing, proposal, confirmOverlap);
      setEditing(null);
    } catch (failure) { setDialogError(failure.message || 'Could not save this time. Please try again.'); }
    finally { setSaving(false); }
  };

  const drop = async ({ active: dragged, over }) => {
    setActive(null);
    const item = dragged.data.current?.item;
    const minute = over?.data.current?.minute;
    if (!item || minute === undefined || !resolveTime) return;
    const input = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    try {
      const existing = blocks.find((block) => blockKey(block) === itemKey(item));
      const minutes = existing ? Math.round((new Date(existing.ends_at) - new Date(existing.starts_at)) / 60000) : 30;
      const next = resolveTime(localDate, input, timezone, 'earlier', minutes);
      if (next.ambiguous || !(await commit(item, next))) edit(item, minute);
    } catch (failure) { edit(item, minute); setDialogError(failure.message); }
  };

  const blockPosition = (block, count) => {
    const start = localParts(block.starts_at, timezone);
    const end = localParts(block.ends_at, timezone);
    const startMinute = start.date < localDate ? 0 : start.minutes;
    const endMinute = end.date > localDate ? 1440 : end.minutes;
    return { position: 'absolute', top: startMinute * 2.4, height: Math.max(36, (endMinute - startMinute) * 2.4), left: `${block.lane / count * 100}%`, width: `${100 / count}%`, overflow: 'auto' };
  };
  const timeLabel = (block) => {
    const start = localParts(block.starts_at, timezone);
    const end = localParts(block.ends_at, timezone);
    return `${start.time}–${end.time}${end.date !== start.date ? ' (+1 day)' : ''}`;
  };

  return (
    <section aria-labelledby="tomorrow-scheduler-title" className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
      <div>
        <h3 id="tomorrow-scheduler-title" className="font-semibold text-white">Schedule tomorrow</h3>
        <p className="mt-1 text-sm text-zinc-400">Give your actions a place in the day. Scheduling is optional.</p>
        <p className="mt-2 text-xs text-zinc-400">{localDate} · {timezone} · Times are optional</p>
      </div>
      {!available ? <div role="status" className="space-y-2 rounded-xl bg-amber-950/30 p-3 text-sm text-amber-200"><p>Scheduling is not available yet. You can still save your actions and complete your review. Try again after scheduling has been enabled for your account.</p>{onRetry && <button type="button" onClick={onRetry} className={buttonClass}>Retry scheduling</button>}</div> : <>
        <GoogleCalendarConnection userId={userId} localDate={localDate} timezone={timezone} onEvents={setGoogleEvents} />
        <div role="status" aria-live="polite" className="text-xs text-zinc-400">{saveError ? <span className="text-amber-300">{typeof saveError === 'string' ? saveError : saveError.message}</span> : saveStatus === 'saving' ? 'Saving schedule…' : saveStatus === 'saved' ? 'Schedule saved' : 'Schedule changes save automatically.'}</div>
        <DndContext sensors={sensors} onDragStart={({ active: dragged }) => setActive(dragged.data.current.item)} onDragCancel={() => setActive(null)} onDragEnd={drop}>
          <div className="grid gap-4 md:grid-cols-[minmax(160px,1fr)_minmax(0,3fr)]">
            <aside aria-label="Unscheduled items" className="space-y-2">
              <h4 className="text-sm font-medium text-zinc-300">Unscheduled ({unscheduled.length})</h4>
              <p className="text-xs text-zinc-500">Default estimate: 30 minutes. Use the drag handle; the rest of the page scrolls normally.</p>
              <div className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-x-visible">
                {unscheduled.map((item) => <div key={itemKey(item)} className="min-w-[160px] md:min-w-0"><DraggableItem item={item} onEdit={edit} disabled={readOnly} /></div>)}
              </div>
              {!unscheduled.length && <p className="text-xs text-zinc-500">{items.length ? 'Everything has a time.' : 'Save an action or add a habit to begin.'}</p>}
            </aside>
            <div className="min-w-0">
              {allDay.length > 0 && <div aria-label="All-day Google events" className="mb-2 space-y-1 rounded-lg border border-zinc-700 p-2"><p className="text-xs text-zinc-400">All day · Google (read-only)</p>{allDay.map((event) => <p key={event.id} className="text-xs text-zinc-500">{event.summary || event.title || 'Busy'}{event.ends_at || event.end ? ` · until ${event.ends_at || event.end?.date || event.end} (exclusive)` : ''}{event.transparency === 'transparent' ? ' · Free · non-blocking' : ''}</p>)}</div>}
              <div className="mb-2 grid grid-cols-[44px_1fr_1fr] gap-1 text-[10px] text-zinc-400"><span>Time</span><span>Your plan</span><span>Google · read-only</span></div>
              <div ref={timeline} tabIndex={0} aria-label={`24-hour timeline for ${localDate}, ${timezone}`} className="h-[480px] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950">
                <div className="relative grid grid-cols-[44px_1fr_1fr]" style={{ height: 3456 }}>
                  <div className="relative">{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute left-1 text-[10px] text-zinc-500" style={{ top: hour * 144 }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
                  <div className="relative border-l border-zinc-700">
                    {Array.from({ length: 96 }, (_, index) => <Slot key={index} minute={index * 15} disabled={readOnly} />)}
                    <div className="pointer-events-none absolute inset-0">{localLanes.map((block) => {
                      const item = itemMap.get(blockKey(block));
                      return item ? <div key={block.id || blockKey(block)} className="pointer-events-auto" style={blockPosition(block, laneCount)}><DraggableItem item={item} onEdit={edit} disabled={readOnly}><span className={`mt-1 block ${item.type === 'habit' ? 'text-emerald-200' : 'text-red-200'}`}>{timeLabel(block)}</span></DraggableItem></div> : null;
                    })}</div>
                  </div>
                  <div className="relative border-l border-zinc-700" aria-label="Google events">{googleLanes.map((event) => <div key={event.id} style={blockPosition(event, googleLaneCount)} className="rounded border border-zinc-700 bg-zinc-800/60 p-1 text-[10px] text-zinc-400"><span className="block break-words">{event.summary || event.title || 'Busy'}</span><span>{timeLabel(event)}</span>{event.transparency === 'transparent' && <span className="block">Free · non-blocking</span>}</div>)}</div>
                </div>
              </div>
            </div>
          </div>
          <DragOverlay>{active && <div className="max-w-56 rounded-lg border border-red-500 bg-zinc-900 p-3 text-sm text-white">{active.label}</div>}</DragOverlay>
        </DndContext>
      </>}
      <Dialog.Root open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75" />
          <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); focusReturn.current?.focus?.(); }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-white shadow-xl">
            <Dialog.Title className="font-semibold">Choose a time</Dialog.Title>
            <Dialog.Description className="text-sm text-zinc-400">{editing?.label} · {localDate} · {timezone}</Dialog.Description>
            <form onSubmit={save} className="space-y-4">
              <label className="block space-y-1 text-sm">Start time<input required type="time" step="900" value={time} onChange={(event) => { setTime(event.target.value); setConfirmOverlap(false); }} className={fieldClass} /></label>
              <label className="block space-y-1 text-sm">Duration estimate (minutes)<input required type="number" min="15" max="1440" step="15" value={duration} onChange={(event) => { setDuration(event.target.value); setConfirmOverlap(false); }} className={fieldClass} /></label>
              {proposal?.ambiguous && <label className="block space-y-1 text-sm">This time occurs twice (daylight saving)<select value={occurrence} onChange={(event) => setOccurrence(event.target.value)} className={fieldClass}><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>}
              {proposal && <p className="text-xs text-zinc-400">{timeLabel(proposal)} · elapsed duration estimate</p>}
              {overlaps.length > 0 && <div className="space-y-2 rounded-lg border border-amber-700 p-3 text-sm text-amber-200"><p>This overlaps your plan or a busy Google event.</p><label className="flex gap-2"><input type="checkbox" checked={confirmOverlap} onChange={(event) => setConfirmOverlap(event.target.checked)} />Keep this overlap intentionally</label></div>}
              {(timeError || dialogError) && <p role="alert" className="text-sm text-amber-300">{timeError || dialogError}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={saving || !proposal || Boolean(timeError) || (overlaps.length > 0 && !confirmOverlap)} className="rounded-lg bg-red-600 px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save time'}</button>
                {editing && scheduledKeys.has(itemKey(editing)) && <button type="button" disabled={saving} className={buttonClass} onClick={async () => { setSaving(true); try { await onUnschedule(itemKey(editing)); setEditing(null); } catch (failure) { setDialogError(failure.message); } finally { setSaving(false); } }}>Unschedule</button>}
                <Dialog.Close asChild><button type="button" disabled={saving} className={buttonClass}>Cancel</button></Dialog.Close>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
