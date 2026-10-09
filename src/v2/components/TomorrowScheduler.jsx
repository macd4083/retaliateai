import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { clipScheduleBlocksToDate, getScheduleDateBounds, getScheduleDayOffset, layoutScheduleBlocks, resizeScheduleBlock, snapScheduleMinutes, zonedLocalTimeToTimestamp } from '../today/scheduling';

const fieldClass = 'w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white';
const buttonClass = 'rounded-lg border border-zinc-600 px-3 py-2 text-sm hover:border-zinc-400 disabled:opacity-50';
const itemKey = (item) => item.key || item.item_key || item.id;
const blockKey = (block) => block.source_key || block.item_key || block.key;
const unscheduledTrayId = 'unscheduled-tray';

class MousePenPointerSensor extends PointerSensor {
  static activators = PointerSensor.activators.map((activator) => ({
    ...activator,
    handler: (event, ...args) => event.nativeEvent.pointerType !== 'touch' && activator.handler(event, ...args),
  }));
}

function resolveScheduleTime(localDate, time, timezone, occurrence, duration) {
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('Choose a duration from 1 minute to 24 hours.');
  const earlier = zonedLocalTimeToTimestamp(localDate, time, timezone, 'earlier');
  const later = zonedLocalTimeToTimestamp(localDate, time, timezone, 'later');
  const starts_at = occurrence === 'later' ? later : earlier;
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

function UnscheduledTray({ disabled, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: unscheduledTrayId, disabled });
  return (
    <aside ref={setNodeRef} aria-label="Unscheduled items" className={`min-h-40 space-y-2 self-start rounded-3xl border bg-zinc-950 p-4 ${isOver ? 'border-red-500 ring-2 ring-red-500/40' : 'border-zinc-700'}`}>
      {children}
    </aside>
  );
}

function ResizeHandles({ label, block, disabled, onStart, onMove, onEnd, onCancel, onEdit }) {
  if (disabled) return null;
  return ['start', 'end'].filter((edge) => edge === 'start' ? !block.continued : !block.continues).map((edge) => (
    <button key={edge} type="button" aria-label={`Resize ${edge} of ${label}; press Enter to edit time`}
      data-resize-edge={edge} style={{ touchAction: 'none' }}
      className={`absolute inset-x-0 z-10 h-3 cursor-ns-resize rounded bg-zinc-400/30 hover:bg-zinc-300/60 focus:bg-zinc-300/60 ${edge === 'start' ? 'top-0' : 'bottom-0'}`}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); if (event.button !== 0) return; if (onStart(edge, event)) event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={(event) => { event.stopPropagation(); onMove(event); }}
      onPointerUp={(event) => { event.preventDefault(); event.stopPropagation(); onEnd(event); }}
      onPointerCancel={onCancel} onLostPointerCapture={onCancel}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(); } if (event.key === 'Escape') onCancel(); }}
    />
  ));
}

function DraggableItem({ item, onEdit, disabled, style = undefined, compact = false, short = false, timeDescription = '', children = null }) {
  const key = itemKey(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: key, data: { item }, disabled });
  return (
    <div ref={setNodeRef} onPointerDown={disabled ? undefined : (event) => { if (!event.target.closest('[data-scheduler-drag-key]')) listeners?.onPointerDown?.(event); }} style={style} className={`flex gap-1 rounded-lg border ${item.type === 'habit' ? 'border-emerald-700/70 bg-emerald-950/40' : 'border-red-800/60 bg-zinc-900'} ${compact ? 'h-full overflow-hidden p-1' : 'p-2'} text-xs ${isDragging ? 'opacity-40' : ''}`}>
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
  userId, localDate, timezone = 'UTC', items = [], blocks = [], contextBlocks = [], googleEvents = [], available = true, readOnly = false, completionSaving = false,
  saveStatus, saveError, availabilityError, onUpdate, onUnschedule, onRetry, onGoogleEdit, onGoogleUpdate, resolveTime = resolveScheduleTime,
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
  const [resize, setResize] = React.useState(null);
  const resizeRef = React.useRef(null);
  const timeline = React.useRef(null);
  const schedulerRoot = React.useRef(null);
  const focusReturn = React.useRef(null);
  const focusItemKey = React.useRef(null);
  const interaction = React.useRef({ scope: '', generation: 0, locked: true });
  const dragGeneration = React.useRef(null);
  const editingGeneration = React.useRef(null);
  const writePending = React.useRef(null);
  const dayBounds = React.useMemo(() => {
    try { return { ...getScheduleDateBounds(localDate, timezone), error: null }; }
    catch (failure) { return { starts_at: null, ends_at: null, error: failure?.message || 'This date or timezone is unavailable.' }; }
  }, [localDate, timezone]);
  const dayStart = Date.parse(dayBounds.starts_at);
  const dayEnd = Date.parse(dayBounds.ends_at);
  const dayMinutes = dayBounds.error ? 0 : (dayEnd - dayStart) / 60000;
  const timelineAvailable = available && !dayBounds.error;
  const locked = readOnly || completionSaving || !timelineAvailable;
  const scope = `${userId}:${localDate}:${timezone}:${locked}`;
  if (interaction.current.scope !== scope) {
    interaction.current = { scope, generation: interaction.current.generation + 1, locked };
  }
  const generation = interaction.current.generation;
  const slots = React.useMemo(() => Array.from({ length: Math.ceil(dayMinutes / 15) }, (_, index) => {
    const timestamp = new Date(dayStart + index * 15 * 60000).toISOString();
    return { timestamp, minute: index * 15, ...localParts(timestamp, timezone) };
  }), [dayStart, dayMinutes, timezone]);
  const detectTimeSlot = React.useCallback((args) => {
    const trayTargets = args.droppableContainers.filter((entry) => entry.id === unscheduledTrayId && !entry.disabled);
    if (trayTargets.length) {
      const trayHits = pointerWithin({ ...args, droppableContainers: trayTargets });
      if (trayHits.length) return trayHits;
    }
    const viewport = timeline.current;
    const pointer = args.pointerCoordinates;
    if (!viewport || !pointer) return pointerWithin(args);
    const rect = viewport.getBoundingClientRect();
    if (pointer.x < rect.left + 52 || pointer.x >= rect.right || pointer.y < rect.top || pointer.y >= rect.bottom) return [];
    const minute = Math.min(dayMinutes - 15, Math.max(0, snapScheduleMinutes((pointer.y - rect.top + viewport.scrollTop) / 2.4)));
    const timestamp = new Date(dayStart + minute * 60000).toISOString();
    const target = args.droppableContainers.find((entry) => entry.id === `slot:${timestamp}` && !entry.disabled);
    return target ? [{ id: target.id }] : [];
  }, [dayMinutes, dayStart]);
  const previewBlock = (block, google = false) => resize?.generation === generation && resize.google === google &&
    (google ? block.id === resize.block.id : blockKey(block) === blockKey(resize.block)) ? { ...block, ...resize.next } : block;
  const visibleBlocks = clipScheduleBlocksToDate(blocks.map((block) => previewBlock(block)), dayBounds).map((block) => ({
    ...block, read_only_context: block.read_only_context || block.continued || Boolean(block.target_local_date && block.target_local_date < localDate),
  }));
  const editableBlocks = visibleBlocks.filter((block) => !block.read_only_context);
  const scheduledKeys = new Set(editableBlocks.map(blockKey));
  const unscheduled = items.filter((item) => !scheduledKeys.has(itemKey(item)));
  const itemMap = new Map(items.map((item) => [itemKey(item), item]));
  const carryoverBlocks = clipScheduleBlocksToDate(contextBlocks, dayBounds).filter((block) => block.continued
    && !visibleBlocks.some((existing) => (block.id && existing.id === block.id) || (blockKey(block) && blockKey(existing) === blockKey(block) && existing.starts_at === block.starts_at)))
    .map((block) => ({ ...block, read_only_context: true }));
  const sortedBlocks = [...visibleBlocks, ...carryoverBlocks].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const timedGoogle = googleEvents.filter((event) => !event.all_day && !event.allDay && !(event.start?.date)).map((event) => ({
    ...previewBlock({ ...event, starts_at: event.starts_at || event.start?.dateTime || event.start, ends_at: event.ends_at || event.end?.dateTime || event.end }, true),
  })).filter((event) => event.starts_at && event.ends_at).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const lanes = layoutScheduleBlocks([
    ...sortedBlocks,
    ...clipScheduleBlocksToDate(timedGoogle, dayBounds).map((event) => ({ ...event, imported: true })),
  ]);
  const localLanes = lanes.filter((block) => !block.imported);
  const googleLanes = lanes.filter((block) => block.imported);
  const laneCount = Math.max(1, ...lanes.map((block) => block.lane + 1));
  const allDayEvents = googleEvents.filter((event) => event.all_day || event.allDay || event.start?.date);
  const allDay = allDayEvents.filter((event) => (event.start?.date || event.start || event.starts_at) <= localDate && (event.end?.date || event.end || event.ends_at) > localDate);

  React.useEffect(() => {
    if (timeline.current) timeline.current.scrollTop = (slots.find((slot) => slot.time === '08:00')?.minute || 0) * 2.4;
  }, [slots, available]);

  React.useEffect(() => {
    setActive(null);
    setEditing(null);
    setConfirmOverlap(false);
    setDialogError('');
    setSaving(false);
    setResize(null);
    resizeRef.current = null;
    writePending.current = null;
    dragGeneration.current = null;
    editingGeneration.current = null;
  }, [scope]);

  const cancelResize = () => {
    if (resizeRef.current?.dragging) {
      resizeRef.current = null;
      setResize(null);
    }
  };
  React.useEffect(() => {
    const cancel = (event) => {
      if (event.key === 'Escape' && writePending.current !== interaction.current.generation) {
        resizeRef.current = null;
        setResize(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  const startResize = (block, google, edge, event) => {
    if (interaction.current.locked || generation !== interaction.current.generation || writePending.current === generation || resizeRef.current || active || editing) return false;
    const next = { starts_at: block.starts_at, ends_at: block.ends_at };
    const value = { block, google, edge, next, generation, pointerId: event.pointerId, y: event.clientY, scroll: timeline.current?.scrollTop || 0, dragging: true };
    resizeRef.current = value;
    setResize(value);
    setDialogError('');
    setConfirmOverlap(false);
    return true;
  };
  const moveResize = (event) => {
    const current = resizeRef.current;
    if (!current?.dragging || current.pointerId !== event.pointerId || current.generation !== interaction.current.generation || interaction.current.locked) return;
    try {
      const delta = (event.clientY - current.y + (timeline.current?.scrollTop || 0) - current.scroll) / 2.4;
      const next = resizeScheduleBlock(current.block, current.edge, delta, dayBounds, current.google ? 31 * 1440 - 15 : 1440);
      resizeRef.current = { ...current, next };
      setResize(resizeRef.current);
    } catch (failure) { setDialogError(failure.message); }
  };
  const endResize = (event) => {
    const current = resizeRef.current;
    if (!current?.dragging || current.pointerId !== event.pointerId) return;
    moveResize(event);
    resizeRef.current = { ...resizeRef.current, dragging: false };
    setResize(resizeRef.current);
  };

  const edit = (item, timestamp) => {
    if (interaction.current.locked || generation !== interaction.current.generation || writePending.current === generation || resize) return;
    focusReturn.current = [...(schedulerRoot.current?.querySelectorAll('[data-scheduler-edit-key]') || [])].find((node) => node.getAttribute('data-scheduler-edit-key') === itemKey(item)) || document.activeElement;
    if (schedulerRoot.current?.contains(document.activeElement) && document.activeElement !== document.body) focusReturn.current = document.activeElement;
    focusItemKey.current = itemKey(item);
    const existing = editableBlocks.find((block) => blockKey(block) === itemKey(item));
    const chosenStart = timestamp || existing?.starts_at;
    const chosenTime = chosenStart ? localParts(chosenStart, timezone).time : item.preferred_time || '09:00';
    setTime(chosenTime);
    setDuration(existing ? (Date.parse(existing.ends_at) - Date.parse(existing.starts_at)) / 60000 : item.duration_minutes || 30);
    setOccurrence(chosenStart ? Date.parse(chosenStart) === Date.parse(zonedLocalTimeToTimestamp(localDate, chosenTime, timezone, 'later')) ? 'later' : 'earlier' : item.occurrence || '');
    setConfirmOverlap(false);
    setDialogError('');
    editingGeneration.current = generation;
    setEditing(item);
  };

  let proposal = null;
  let timeError = '';
  try {
    if (editing && resolveTime && !dayBounds.error) proposal = resolveTime(localDate, time, timezone, occurrence || 'earlier', Number(duration));
  } catch (failure) { timeError = failure.message; }
  const busyAllDay = allDayEvents.filter((event) => event.transparency !== 'transparent').flatMap((event) => {
    try {
      const startDate = event.start?.date || event.start || event.starts_at;
      const endDate = event.end?.date || event.end || event.ends_at;
      return [{ starts_at: getScheduleDateBounds(startDate, timezone).starts_at, ends_at: getScheduleDateBounds(endDate, timezone).starts_at }];
    } catch { return []; }
  });
  const conflictBlocks = [...blocks.map((block) => ({ ...block, read_only_context: block.read_only_context || Date.parse(block.starts_at) < dayStart || Boolean(block.target_local_date && block.target_local_date < localDate) })), ...carryoverBlocks, ...timedGoogle.filter((event) => event.transparency !== 'transparent'), ...busyAllDay];
  const overlaps = proposal?.starts_at ? conflictBlocks.filter((block) => (block.read_only_context || blockKey(block) !== itemKey(editing)) && new Date(block.starts_at) < new Date(proposal.ends_at) && new Date(block.ends_at) > new Date(proposal.starts_at)) : [];

  const commit = async (item, next, explicitOverlap = false) => {
    if (interaction.current.locked || generation !== interaction.current.generation || !items.some((candidate) => itemKey(candidate) === itemKey(item))) return false;
    const collisions = conflictBlocks.some((block) => (block.read_only_context || blockKey(block) !== itemKey(item)) && new Date(block.starts_at) < new Date(next.ends_at) && new Date(block.ends_at) > new Date(next.starts_at));
    if (collisions && !explicitOverlap) return false;
    await onUpdate(itemKey(item), { starts_at: next.starts_at, ends_at: next.ends_at });
    return true;
  };

  const resizeConflicts = resize ? conflictBlocks.filter((block) =>
    !(resize.google ? block.id === resize.block.id : blockKey(block) === blockKey(resize.block)) &&
    Date.parse(block.starts_at) < Date.parse(resize.next.ends_at) && Date.parse(block.ends_at) > Date.parse(resize.next.starts_at)) : [];
  const saveResize = async () => {
    const current = resizeRef.current;
    if (!current || current.dragging || current.generation !== generation || generation !== interaction.current.generation ||
      interaction.current.locked || writePending.current === generation || (resizeConflicts.length && !confirmOverlap)) return;
    writePending.current = generation;
    setSaving(true);
    setDialogError('');
    try {
      if (current.google) {
        const event = googleEvents.find((candidate) => candidate.id === current.block.id);
        if (!event?.editable || !onGoogleUpdate) throw new Error('This Google event is no longer editable. Refresh your calendar.');
        await onGoogleUpdate(event, current.next);
      } else {
        const item = itemMap.get(blockKey(current.block));
        if (!item || !await commit(item, current.next, confirmOverlap)) throw new Error('This schedule changed. Choose its time again.');
      }
      if (generation === interaction.current.generation) { resizeRef.current = null; setResize(null); }
    } catch (failure) {
      if (generation === interaction.current.generation) {
        resizeRef.current = null;
        setResize(null);
        setDialogError(failure.message || 'Could not save resized time. Original times are preserved; retry.');
      }
    } finally {
      if (generation === interaction.current.generation) { writePending.current = null; setSaving(false); }
    }
  };
  const handles = (block, google, label, disabled) => <ResizeHandles label={label}
    block={resize?.generation === generation && resize.google === google && (google ? block.id === resize.block.id : blockKey(block) === blockKey(resize.block)) ? resize.block : block} disabled={disabled}
    onStart={(edge, event) => startResize(block, google, edge, event)} onMove={moveResize} onEnd={endResize} onCancel={cancelResize}
    onEdit={() => google ? onGoogleEdit?.(block) : edit(itemMap.get(blockKey(block)))} />;

  const save = async (event) => {
    event.preventDefault();
    if (interaction.current.locked || generation !== interaction.current.generation || editingGeneration.current !== generation || writePending.current === generation || !editing || !proposal || timeError || (proposal.ambiguous && !occurrence) || (overlaps.length && !confirmOverlap)) return;
    writePending.current = generation;
    setSaving(true);
    setDialogError('');
    try {
      if (await commit(editing, proposal, confirmOverlap) && generation === interaction.current.generation) setEditing(null);
    } catch (failure) { if (generation === interaction.current.generation) setDialogError(failure.message || 'Could not save this time. Please try again.'); }
    finally { if (generation === interaction.current.generation) { writePending.current = null; setSaving(false); } }
  };

  const drop = async ({ active: dragged, over }) => {
    setActive(null);
    if (interaction.current.locked || generation !== interaction.current.generation || dragGeneration.current !== generation || writePending.current === generation) return;
    dragGeneration.current = null;
    const item = dragged.data.current?.item;
    const timestamp = over?.data?.current?.timestamp;
    if (!item || !items.some((candidate) => itemKey(candidate) === itemKey(item))) return;
    const returningToTray = over?.id === unscheduledTrayId;
    if (returningToTray ? !scheduledKeys.has(itemKey(item)) : !timestamp || Date.parse(timestamp) < dayStart || Date.parse(timestamp) >= dayEnd) return;
    try {
      if (returningToTray) {
        writePending.current = generation;
        setSaving(true);
        await onUnschedule(itemKey(item));
        return;
      }
      const existing = editableBlocks.find((block) => blockKey(block) === itemKey(item));
      const minutes = existing ? (Date.parse(existing.ends_at) - Date.parse(existing.starts_at)) / 60000 : item.duration_minutes || 30;
      const next = { starts_at: timestamp, ends_at: new Date(Date.parse(timestamp) + minutes * 60000).toISOString() };
      writePending.current = generation;
      const committed = await commit(item, next);
      if (generation === interaction.current.generation) writePending.current = null;
      if (!committed) edit(item, timestamp);
    } catch (failure) {
      if (generation === interaction.current.generation) writePending.current = null;
      if (generation === interaction.current.generation && !interaction.current.locked) { edit(item, timestamp); setDialogError(failure.message); }
    } finally { if (generation === interaction.current.generation) { writePending.current = null; setSaving(false); } }
  };

  const blockPosition = (block, count) => {
    const startMinute = (Math.max(dayStart, Date.parse(block.starts_at)) - dayStart) / 60000;
    const endMinute = (Math.min(dayEnd, Date.parse(block.ends_at)) - dayStart) / 60000;
    return { position: /** @type {'absolute'} */ ('absolute'), top: startMinute * 2.4, height: Math.max(1, (endMinute - startMinute) * 2.4), left: `${block.lane / count * 100}%`, width: `${100 / count}%`, overflow: /** @type {'auto'} */ ('auto') };
  };
  const timeLabel = (block) => {
    const start = localParts(block.starts_at, timezone);
    const end = localParts(block.ends_at, timezone);
    const dayOffset = getScheduleDayOffset(block.starts_at, block.ends_at, timezone);
    return `${start.time}–${end.time}${start.offset !== end.offset ? ` (${start.offset} → ${end.offset})` : dayMinutes !== 1440 ? ` (${start.offset})` : ''}${dayOffset ? ` (+${dayOffset} day${dayOffset === 1 ? '' : 's'})` : ''}${block.continued ? ' · Continued from previous day' : ''}${block.continues ? ' · Continues tomorrow' : ''}`;
  };

  return (
    <section ref={schedulerRoot} aria-labelledby="tomorrow-scheduler-title" className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
      <div>
        <h3 id="tomorrow-scheduler-title" className="font-semibold text-white">Schedule tomorrow</h3>
        <p className="mt-1 text-sm text-zinc-400">Give your actions a place in the day. Scheduling is optional.</p>
        <p className="mt-1 text-xs text-zinc-400">Your calendar works without connecting Google. Drag actions and habits into your day. Drag a block’s top or bottom to resize, then save the preview; click it to edit exact times. Private commitments are never automatically exported.</p>
        <p className="mt-2 text-xs text-zinc-400">{localDate} · {timezone} · Times are optional</p>
      </div>
      {!timelineAvailable ? <div role="status" className="space-y-2 rounded-xl bg-amber-950/30 p-3 text-sm text-amber-200">{dayBounds.error && <><p>Timeline unavailable for this date or timezone. Your review is still available.</p><p>{dayBounds.error}</p></>}{availabilityError && <p>{availabilityError}</p>}{saveError ? <><p>{typeof saveError === 'string' ? saveError : saveError.message}</p><p>Your local schedule changes are preserved. Retry scheduling before completing your review.</p></> : !dayBounds.error && <p>Scheduling is currently unavailable. You can still save your actions and complete your review. Retry after database setup or connectivity is restored.</p>}{onRetry && <button type="button" onClick={onRetry} className={buttonClass}>Retry scheduling</button>}</div> : <>
        {resize && <div role="status" aria-live="polite" className="space-y-2 rounded-lg border border-zinc-500 p-3 text-sm text-zinc-200">
          <p>Resize preview · {timeLabel(resize.next)} · minimum 15 minutes</p>
          {resizeConflicts.length > 0 && <label className="flex gap-2 text-amber-300"><input type="checkbox" disabled={saving || resize.dragging} checked={confirmOverlap} onChange={(event) => setConfirmOverlap(event.target.checked)} />Keep this overlap intentionally</label>}
          <button type="button" className={buttonClass} disabled={saving || resize.dragging || Boolean(resizeConflicts.length && !confirmOverlap)} onClick={saveResize}>{saving ? 'Saving…' : 'Save resized time'}</button>{' '}
          <button type="button" className={buttonClass} disabled={saving} onClick={() => { resizeRef.current = null; setResize(null); setDialogError(''); }}>Cancel resize</button>
        </div>}
        {!editing && dialogError && <p role="alert" className="text-sm text-amber-300">{dialogError}</p>}
        <div role="status" aria-live="polite" className="text-xs text-zinc-400">{saveError ? <span className="text-amber-300">{typeof saveError === 'string' ? saveError : saveError.message}</span> : saveStatus === 'saving' ? 'Saving schedule…' : saveStatus === 'saved' ? 'Schedule saved' : saveStatus === 'offline' ? 'Schedule pending sync — reconnect to save.' : saveStatus === 'error' ? 'Schedule could not sync. Your review is still available.' : 'Schedule changes save automatically.'}</div>
        <DndContext sensors={sensors} collisionDetection={detectTimeSlot} onDragStart={({ active: dragged }) => { if (!interaction.current.locked && generation === interaction.current.generation && writePending.current !== generation) { dragGeneration.current = generation; setActive(dragged.data.current.item); } }} onDragCancel={() => { dragGeneration.current = null; setActive(null); }} onDragEnd={drop}>
          <div className="grid gap-4 md:grid-cols-[minmax(160px,1fr)_minmax(0,3fr)]">
            <UnscheduledTray disabled={locked || saving}>
              <h4 className="text-sm font-medium text-zinc-300">Unscheduled ({unscheduled.length})</h4>
              <p className="text-xs text-zinc-400">ROI action, starting task · Habits due tomorrow</p>
              <p className="text-xs text-zinc-500">Drag a card onto a time to snap to 15 minutes, or back here to unschedule it. On touch screens, hold its handle. Click a card to set an exact time.</p>
              <div className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-x-visible">
                {unscheduled.map((item) => <div key={itemKey(item)} className="min-w-[160px] md:min-w-0"><DraggableItem item={item} onEdit={edit} disabled={locked || saving || Boolean(resize)} /></div>)}
              </div>
              {!unscheduled.length && <p className="text-xs text-zinc-500">{readOnly ? 'No unscheduled items.' : items.length ? 'Everything has a time.' : 'Save an action or add a habit to begin.'}</p>}
            </UnscheduledTray>
            <div className="min-w-0">
              {allDay.length > 0 && <div aria-label="All-day Google events" className="mb-2 space-y-1 rounded-lg border border-zinc-700 p-2"><p className="text-xs text-zinc-400">All day · Google</p>{allDay.map((event) => <p key={event.id} className="text-xs text-zinc-500">{event.summary || event.title || 'Busy'}{event.ends_at || event.end ? ` · until ${event.ends_at || event.end?.date || event.end} (exclusive)` : ''}{event.transparency === 'transparent' ? ' · Free · non-blocking' : ''}{event.editable && onGoogleEdit && !locked && <button type="button" className={buttonClass} disabled={saving || Boolean(resize)} onClick={() => onGoogleEdit(event)}>Edit {event.title || 'event'}</button>}</p>)}</div>}
              <div className="mb-2 grid grid-cols-[52px_1fr] gap-1 text-[10px] text-zinc-400"><span>Time</span><span>Your plan{googleLanes.length > 0 && ' · Google'}</span></div>
              <div ref={timeline} tabIndex={0} aria-label={`${dayMinutes / 60}-hour timeline for ${localDate}, ${timezone}`} className="h-[760px] md:h-[960px] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950">
                <div className="relative grid grid-cols-[52px_1fr]" style={{ height: dayMinutes * 2.4 }}>
                  <div className="relative">{slots.filter((slot) => slot.minute % 60 === 0).map((slot) => <span key={slot.timestamp} className="absolute left-1 text-[10px] text-zinc-500" style={{ top: slot.minute * 2.4 }}><span className="block">{slot.time}</span><span className="block text-[8px]">{slot.offset}</span></span>)}</div>
                  <div className="relative border-l border-zinc-700">
                    {slots.map((slot) => <Slot key={slot.timestamp} minute={slot.minute} timestamp={slot.timestamp} disabled={locked || saving} />)}
                    <div className="pointer-events-none absolute inset-0">{localLanes.map((block) => {
                      if (block.read_only_context) return <div key={`carryover:${block.id || block.source_id || block.starts_at}`} data-context-schedule-id={block.id} style={blockPosition(block, laneCount)} className="pointer-events-auto rounded-lg border border-indigo-800/60 bg-indigo-950/40 p-2 text-[10px] text-indigo-200"><span className="block break-words font-medium">{block.label || 'Previous-day plan'}</span><span className="mt-1 block">{timeLabel(block)}</span><span className="mt-1 block text-indigo-300">Previous-day · {block.target_local_date || localParts(block.starts_at, timezone).date} · read-only</span></div>;
                      const item = itemMap.get(blockKey(block));
                      if (!item && readOnly) return <div key={block.id || blockKey(block)} data-schedule-key={blockKey(block)} style={blockPosition(block, laneCount)} className="pointer-events-auto rounded-lg border border-zinc-700 bg-zinc-800/60 p-2 text-xs text-zinc-300"><span className="block break-words font-medium">{block.label || (block.source_type === 'habit' || block.habit_definition_id ? 'Scheduled habit' : 'Scheduled commitment')}</span><span className="mt-1 block">{timeLabel(block)}</span><span className="mt-1 block text-[10px] text-zinc-400">Preserved plan · read-only</span></div>;
                      return item ? <div key={block.id || blockKey(block)} data-schedule-key={blockKey(block)} className="pointer-events-auto" style={blockPosition(block, laneCount)}><DraggableItem item={item} onEdit={edit} disabled={locked || saving || Boolean(resize)} compact short={blockPosition(block, laneCount).height <= 36} timeDescription={timeLabel(block)}><span className={`block truncate text-[10px] leading-3 ${item.type === 'habit' ? 'text-emerald-200' : 'text-red-200'}`}>{timeLabel(block)}</span></DraggableItem>{handles(block, false, item.label, locked || saving)}</div> : null;
                    })}</div>
                    {googleLanes.length > 0 && <div className="pointer-events-none absolute inset-0" aria-label="Google events">{googleLanes.map((event) => <div key={event.id} tabIndex={0} title={`${event.summary || event.title || 'Busy'} · ${timeLabel(event)} · Google${event.editable ? '' : ' · read-only'}${event.transparency === 'transparent' ? ' · Free · non-blocking' : ''}`} style={blockPosition(event, laneCount)} className="pointer-events-auto rounded border border-zinc-700 bg-zinc-800/80 p-1 text-[10px] text-zinc-400">
                      {event.editable && onGoogleEdit && !locked ? <button type="button" className="block w-full text-left text-zinc-100" disabled={saving || Boolean(resize)} onClick={() => onGoogleEdit(event)} aria-label={`Edit Google event ${event.title || 'Busy'}`}><span className="block break-words">{event.summary || event.title || 'Busy'}</span><span>{timeLabel(event)}</span></button> : <><span className="block break-words">{event.summary || event.title || 'Busy'}</span><span>{timeLabel(event)}</span></>}
                      <span className="block">Google{event.editable ? ' · Editable' : ' · read-only'}</span>{event.transparency === 'transparent' && <span className="block">Free · non-blocking</span>}
                      {handles(event, true, event.title || 'Google event', locked || saving || !event.editable || !onGoogleUpdate || event.continued)}
                    </div>)}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DragOverlay>{active && <div className="max-w-56 rounded-lg border border-red-500 bg-zinc-900 p-3 text-sm text-white">{active.label}</div>}</DragOverlay>
        </DndContext>
      </>}
      <Dialog.Root open={Boolean(editing) && editingGeneration.current === generation && !locked} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75" />
          <Dialog.Content onCloseAutoFocus={(event) => {
            event.preventDefault();
            const fallback = [...(schedulerRoot.current?.querySelectorAll('[data-scheduler-edit-key]') || [])].find((node) => node.getAttribute('data-scheduler-edit-key') === focusItemKey.current);
            const target = focusReturn.current?.isConnected && !focusReturn.current.disabled && focusReturn.current !== document.body ? focusReturn.current : fallback?.disabled ? timeline.current : fallback || timeline.current;
            target?.focus();
          }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-white shadow-xl">
            <Dialog.Title className="font-semibold">Choose a time</Dialog.Title>
            <Dialog.Description className="text-sm text-zinc-400">{editing?.label} · {localDate} · {timezone}</Dialog.Description>
            <form onSubmit={save} className="space-y-4">
              <label className="block space-y-1 text-sm">Start time<input required type="time" step="60" value={time} onChange={(event) => { setTime(event.target.value); setOccurrence(''); setConfirmOverlap(false); }} className={fieldClass} /></label>
              <label className="block space-y-1 text-sm">Duration estimate (minutes)<input required type="number" min="1" max="1440" step="1" value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setConfirmOverlap(false); }} className={fieldClass} /></label>
              {proposal?.ambiguous && <label className="block space-y-1 text-sm">This time occurs twice (daylight saving)<select required value={occurrence} onChange={(event) => { setOccurrence(event.target.value); setConfirmOverlap(false); }} className={fieldClass}>{!occurrence && <option value="" disabled>Choose an occurrence</option>}<option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>}
              {proposal && <p className="text-xs text-zinc-400">{timeLabel(proposal)} · elapsed duration estimate</p>}
              {overlaps.length > 0 && <div className="space-y-2 rounded-lg border border-amber-700 p-3 text-sm text-amber-200"><p>This overlaps your plan or a busy Google event.</p><label className="flex gap-2"><input type="checkbox" checked={confirmOverlap} onChange={(event) => setConfirmOverlap(event.target.checked)} />Keep this overlap intentionally</label></div>}
              {(timeError || dialogError) && <p role="alert" className="text-sm text-amber-300">{timeError || dialogError}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={locked || saving || !proposal || Boolean(timeError) || (proposal?.ambiguous && !occurrence) || (overlaps.length > 0 && !confirmOverlap)} className="rounded-lg bg-red-600 px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save time'}</button>
                {editing && scheduledKeys.has(itemKey(editing)) && <button type="button" disabled={locked || saving} className={buttonClass} onClick={async () => { if (interaction.current.locked || generation !== interaction.current.generation || writePending.current === generation) return; writePending.current = generation; setSaving(true); try { await onUnschedule(itemKey(editing)); if (generation === interaction.current.generation) setEditing(null); } catch (failure) { if (generation === interaction.current.generation) setDialogError(failure.message); } finally { if (generation === interaction.current.generation) { writePending.current = null; setSaving(false); } } }}>Unschedule</button>}
                <Dialog.Close asChild><button type="button" disabled={saving} className={buttonClass}>Cancel</button></Dialog.Close>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
