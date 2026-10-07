import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import GoogleCalendarConnection from './GoogleCalendarConnection';
import { getScheduleDateBounds, layoutScheduleBlocks, zonedLocalTimeToTimestamp } from '../today/scheduling';

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
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, offset: map.timeZoneName };
}

function Slot({ minute, timestamp, disabled }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${timestamp}`, data: { minute, timestamp }, disabled });
  return <div ref={setNodeRef} data-slot-timestamp={timestamp} aria-hidden="true" className={`h-9 border-t ${minute % 60 === 0 ? 'border-zinc-600/60' : 'border-zinc-800/60'} ${isOver ? 'bg-red-500/25' : ''}`} />;
}

function DraggableItem({ item, onEdit, disabled, style, compact = false, short = false, timeDescription, children }) {
  const key = itemKey(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: key, data: { item }, disabled });
  return (
    <div ref={setNodeRef} style={style} className={`flex gap-1 rounded-lg border ${item.type === 'habit' ? 'border-emerald-700/70 bg-emerald-950/40' : 'border-red-800/60 bg-zinc-900'} ${compact ? 'h-full overflow-hidden p-1' : 'p-2'} text-xs ${isDragging ? 'opacity-40' : ''}`}>
      {!disabled && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} data-scheduler-drag-key={key} aria-label={`Drag ${item.label}; press Enter to edit time`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(item); } }} style={{ touchAction: 'none' }} className="shrink-0 rounded px-1 text-zinc-400 hover:text-white">⠿</button>}
      <button type="button" data-scheduler-edit-key={key} disabled={disabled} aria-label={`${item.label} · ${item.type === 'habit' ? 'Habit' : 'Commitment'}${timeDescription ? ` · ${timeDescription}` : ''}${disabled ? '' : ' · Edit time'}`} title={`${item.label}${timeDescription ? ` · ${timeDescription}` : ''}`} onClick={() => onEdit(item)} className={`min-w-0 flex-1 text-left text-zinc-100 ${compact ? 'min-h-0 overflow-hidden' : ''}`}>
        <span className={`font-medium ${compact ? short ? 'block truncate text-[10px] leading-3' : 'line-clamp-2 break-words leading-[14px]' : 'block break-words'}`}>{compact && <span aria-hidden="true">{item.type === 'habit' ? '↻ ' : '◆ '}</span>}{item.label}</span>
        {children}
        {!short && <span className={`block truncate text-[10px] ${compact ? 'leading-3' : 'mt-1'} ${item.type === 'habit' ? 'text-emerald-300' : 'text-red-300'}`}>{item.type === 'habit' ? '↻ Habit' : '◆ Commitment'}{!disabled && !compact && ' · Edit time'}</span>}
      </button>
    </div>
  );
}

export default function TomorrowScheduler({
  userId, localDate, timezone = 'UTC', items = [], blocks = [], contextBlocks = [], available = true, readOnly = false,
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
  const schedulerRoot = React.useRef(null);
  const focusReturn = React.useRef(null);
  const focusItemKey = React.useRef(null);
  const dayBounds = React.useMemo(() => {
    try { return { ...getScheduleDateBounds(localDate, timezone), error: null }; }
    catch (failure) { return { starts_at: null, ends_at: null, error: failure?.message || 'This date or timezone is unavailable.' }; }
  }, [localDate, timezone]);
  const dayStart = Date.parse(dayBounds.starts_at);
  const dayEnd = Date.parse(dayBounds.ends_at);
  const dayMinutes = dayBounds.error ? 0 : (dayEnd - dayStart) / 60000;
  const timelineAvailable = available && !dayBounds.error;
  const slots = React.useMemo(() => Array.from({ length: Math.ceil(dayMinutes / 15) }, (_, index) => {
    const timestamp = new Date(dayStart + index * 15 * 60000).toISOString();
    return { timestamp, minute: index * 15, ...localParts(timestamp, timezone) };
  }), [dayStart, dayMinutes, timezone]);
  const scheduledKeys = new Set(blocks.map(blockKey));
  const unscheduled = items.filter((item) => !scheduledKeys.has(itemKey(item)));
  const itemMap = new Map(items.map((item) => [itemKey(item), item]));
  const carryoverBlocks = contextBlocks.filter((block) => Date.parse(block.starts_at) < dayStart && Date.parse(block.ends_at) > dayStart).map((block) => ({ ...block, read_only_context: true }));
  const sortedBlocks = [...blocks, ...carryoverBlocks].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const localLanes = layoutScheduleBlocks(sortedBlocks);
  const laneCount = Math.max(1, ...localLanes.map((block) => block.lane + 1));
  const timedGoogle = googleEvents.filter((event) => !event.all_day && !event.allDay && !(event.start?.date)).map((event) => ({
    ...event, starts_at: event.starts_at || event.start?.dateTime || event.start, ends_at: event.ends_at || event.end?.dateTime || event.end,
  })).filter((event) => event.starts_at && event.ends_at).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const googleLanes = layoutScheduleBlocks(timedGoogle);
  const googleLaneCount = Math.max(1, ...googleLanes.map((block) => block.lane + 1));
  const allDay = googleEvents.filter((event) => event.all_day || event.allDay || event.start?.date);

  React.useEffect(() => {
    if (timeline.current) timeline.current.scrollTop = (slots.find((slot) => slot.time === '08:00')?.minute || 0) * 2.4;
  }, [slots, available]);

  const edit = (item, timestamp) => {
    focusReturn.current = document.activeElement;
    focusItemKey.current = itemKey(item);
    const existing = blocks.find((block) => blockKey(block) === itemKey(item));
    const chosenStart = timestamp || existing?.starts_at;
    const chosenTime = chosenStart ? localParts(chosenStart, timezone).time : '09:00';
    setTime(chosenTime);
    setDuration(existing ? Math.max(15, Math.round((new Date(existing.ends_at) - new Date(existing.starts_at)) / 60000)) : 30);
    setOccurrence(chosenStart && Date.parse(chosenStart) === Date.parse(zonedLocalTimeToTimestamp(localDate, chosenTime, timezone, 'later')) ? 'later' : 'earlier');
    setConfirmOverlap(false);
    setDialogError('');
    setEditing(item);
  };

  let proposal = null;
  let timeError = '';
  try {
    if (editing && resolveTime && !dayBounds.error) proposal = resolveTime(localDate, time, timezone, occurrence, Number(duration));
  } catch (failure) { timeError = failure.message; }
  const busyAllDay = allDay.filter((event) => event.transparency !== 'transparent' && (event.start?.date || event.start || event.starts_at) <= localDate && (event.end?.date || event.end || event.ends_at) > localDate).map((event) => ({
    starts_at: '0001-01-01T00:00:00Z', ends_at: '9999-12-31T00:00:00Z',
  }));
  const conflictBlocks = [...blocks, ...carryoverBlocks, ...timedGoogle.filter((event) => event.transparency !== 'transparent'), ...busyAllDay];
  const overlaps = proposal?.starts_at ? conflictBlocks.filter((block) => (block.read_only_context || blockKey(block) !== itemKey(editing)) && new Date(block.starts_at) < new Date(proposal.ends_at) && new Date(block.ends_at) > new Date(proposal.starts_at)) : [];

  const commit = async (item, next, explicitOverlap = false) => {
    const collisions = conflictBlocks.some((block) => (block.read_only_context || blockKey(block) !== itemKey(item)) && new Date(block.starts_at) < new Date(next.ends_at) && new Date(block.ends_at) > new Date(next.starts_at));
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
    const timestamp = over?.data.current?.timestamp;
    if (!item || !timestamp) return;
    try {
      const existing = blocks.find((block) => blockKey(block) === itemKey(item));
      const minutes = existing ? Math.round((new Date(existing.ends_at) - new Date(existing.starts_at)) / 60000) : 30;
      const next = { starts_at: timestamp, ends_at: new Date(Date.parse(timestamp) + minutes * 60000).toISOString() };
      if (!(await commit(item, next))) edit(item, timestamp);
    } catch (failure) { edit(item, timestamp); setDialogError(failure.message); }
  };

  const blockPosition = (block, count) => {
    const startMinute = (Math.max(dayStart, Date.parse(block.starts_at)) - dayStart) / 60000;
    const endMinute = (Math.min(dayEnd, Date.parse(block.ends_at)) - dayStart) / 60000;
    return { position: 'absolute', top: startMinute * 2.4, height: Math.max(1, (endMinute - startMinute) * 2.4), left: `${block.lane / count * 100}%`, width: `${100 / count}%`, overflow: 'auto' };
  };
  const timeLabel = (block) => {
    const start = localParts(block.starts_at, timezone);
    const end = localParts(block.ends_at, timezone);
    return `${start.time}–${end.time}${start.offset !== end.offset ? ` (${start.offset} → ${end.offset})` : dayMinutes !== 1440 ? ` (${start.offset})` : ''}${end.date !== start.date ? ' (+1 day)' : ''}`;
  };

  return (
    <section ref={schedulerRoot} aria-labelledby="tomorrow-scheduler-title" className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
      <div>
        <h3 id="tomorrow-scheduler-title" className="font-semibold text-white">Schedule tomorrow</h3>
        <p className="mt-1 text-sm text-zinc-400">Give your actions a place in the day. Scheduling is optional.</p>
        <p className="mt-2 text-xs text-zinc-400">{localDate} · {timezone} · Times are optional</p>
      </div>
      {!timelineAvailable ? <div role="status" className="space-y-2 rounded-xl bg-amber-950/30 p-3 text-sm text-amber-200">{dayBounds.error && <><p>Timeline unavailable for this date or timezone. Your review is still available.</p><p>{dayBounds.error}</p></>}{saveError ? <><p>{typeof saveError === 'string' ? saveError : saveError.message}</p><p>Your local schedule changes are preserved. Retry scheduling before completing your review.</p></> : !dayBounds.error && <p>Scheduling is not available yet. You can still save your actions and complete your review. Try again after scheduling has been enabled for your account.</p>}{onRetry && <button type="button" onClick={onRetry} className={buttonClass}>Retry scheduling</button>}</div> : <>
        <GoogleCalendarConnection userId={userId} localDate={localDate} timezone={timezone} onEvents={setGoogleEvents} />
        <div role="status" aria-live="polite" className="text-xs text-zinc-400">{saveError ? <span className="text-amber-300">{typeof saveError === 'string' ? saveError : saveError.message}</span> : saveStatus === 'saving' ? 'Saving schedule…' : saveStatus === 'saved' ? 'Schedule saved' : saveStatus === 'offline' ? 'Schedule saved on this device — reconnect to sync.' : saveStatus === 'error' ? 'Schedule could not sync. Your review is still available.' : 'Schedule changes save automatically.'}</div>
        <DndContext sensors={sensors} onDragStart={({ active: dragged }) => setActive(dragged.data.current.item)} onDragCancel={() => setActive(null)} onDragEnd={drop}>
          <div className="grid gap-4 md:grid-cols-[minmax(160px,1fr)_minmax(0,3fr)]">
            <aside aria-label="Unscheduled items" className="space-y-2">
              <h4 className="text-sm font-medium text-zinc-300">Unscheduled ({unscheduled.length})</h4>
              <p className="text-xs text-zinc-500">Default estimate: 30 minutes. Use the drag handle; the rest of the page scrolls normally.</p>
              <div className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-x-visible">
                {unscheduled.map((item) => <div key={itemKey(item)} className="min-w-[160px] md:min-w-0"><DraggableItem item={item} onEdit={edit} disabled={readOnly} /></div>)}
              </div>
              {!unscheduled.length && <p className="text-xs text-zinc-500">{readOnly ? 'No unscheduled items.' : items.length ? 'Everything has a time.' : 'Save an action or add a habit to begin.'}</p>}
            </aside>
            <div className="min-w-0">
              {allDay.length > 0 && <div aria-label="All-day Google events" className="mb-2 space-y-1 rounded-lg border border-zinc-700 p-2"><p className="text-xs text-zinc-400">All day · Google (read-only)</p>{allDay.map((event) => <p key={event.id} className="text-xs text-zinc-500">{event.summary || event.title || 'Busy'}{event.ends_at || event.end ? ` · until ${event.ends_at || event.end?.date || event.end} (exclusive)` : ''}{event.transparency === 'transparent' ? ' · Free · non-blocking' : ''}</p>)}</div>}
              <div className="mb-2 grid grid-cols-[52px_1fr_1fr] gap-1 text-[10px] text-zinc-400"><span>Time</span><span>Your plan</span><span>Google · read-only</span></div>
              <div ref={timeline} tabIndex={0} aria-label={`${dayMinutes / 60}-hour timeline for ${localDate}, ${timezone}`} className="h-[480px] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950">
                <div className="relative grid grid-cols-[52px_1fr_1fr]" style={{ height: dayMinutes * 2.4 }}>
                  <div className="relative">{slots.filter((slot) => slot.minute % 60 === 0).map((slot) => <span key={slot.timestamp} className="absolute left-1 text-[10px] text-zinc-500" style={{ top: slot.minute * 2.4 }}><span className="block">{slot.time}</span><span className="block text-[8px]">{slot.offset}</span></span>)}</div>
                  <div className="relative border-l border-zinc-700">
                    {slots.map((slot) => <Slot key={slot.timestamp} minute={slot.minute} timestamp={slot.timestamp} disabled={readOnly} />)}
                    <div className="pointer-events-none absolute inset-0">{localLanes.map((block) => {
                      if (block.read_only_context) return <div key={`carryover:${block.id || block.source_id || block.starts_at}`} data-context-schedule-id={block.id} style={blockPosition(block, laneCount)} className="pointer-events-auto rounded-lg border border-indigo-800/60 bg-indigo-950/40 p-2 text-[10px] text-indigo-200"><span className="block break-words font-medium">{block.label || 'Previous-day plan'}</span><span className="mt-1 block">{timeLabel(block)}</span><span className="mt-1 block text-indigo-300">Previous-day · {block.target_local_date || localParts(block.starts_at, timezone).date} · read-only</span></div>;
                      const item = itemMap.get(blockKey(block));
                      if (!item && readOnly) return <div key={block.id || blockKey(block)} data-schedule-key={blockKey(block)} style={blockPosition(block, laneCount)} className="pointer-events-auto rounded-lg border border-zinc-700 bg-zinc-800/60 p-2 text-xs text-zinc-300"><span className="block break-words font-medium">{block.label || (block.source_type === 'habit' || block.habit_definition_id ? 'Scheduled habit' : 'Scheduled commitment')}</span><span className="mt-1 block">{timeLabel(block)}</span><span className="mt-1 block text-[10px] text-zinc-400">Preserved plan · read-only</span></div>;
                      return item ? <div key={block.id || blockKey(block)} data-schedule-key={blockKey(block)} className="pointer-events-auto" style={blockPosition(block, laneCount)}><DraggableItem item={item} onEdit={edit} disabled={readOnly} compact short={blockPosition(block, laneCount).height <= 36} timeDescription={timeLabel(block)}><span className={`block truncate text-[10px] leading-3 ${item.type === 'habit' ? 'text-emerald-200' : 'text-red-200'}`}>{timeLabel(block)}</span></DraggableItem></div> : null;
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
      <Dialog.Root open={Boolean(editing) && !dayBounds.error} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75" />
          <Dialog.Content onCloseAutoFocus={(event) => {
            event.preventDefault();
            const fallback = [...(schedulerRoot.current?.querySelectorAll('[data-scheduler-edit-key]') || [])].find((node) => node.getAttribute('data-scheduler-edit-key') === focusItemKey.current);
            const target = focusReturn.current?.isConnected && focusReturn.current !== document.body ? focusReturn.current : fallback;
            target?.focus();
          }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-white shadow-xl">
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
