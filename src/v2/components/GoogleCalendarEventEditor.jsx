import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { zonedLocalTimeToTimestamp } from '../today/scheduling';

const inputClass = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50';

function localInput(timestamp, timezone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function existingOccurrence(timestamp, timezone) {
  if (!timestamp) return '';
  const [date, time] = localInput(timestamp, timezone).split('T');
  const earlier = zonedLocalTimeToTimestamp(date, time, timezone, 'earlier');
  const later = zonedLocalTimeToTimestamp(date, time, timezone, 'later');
  if (earlier === later) return '';
  return Math.floor(Date.parse(timestamp) / 1000) === Math.floor(Date.parse(later) / 1000) ? 'later' : 'earlier';
}

export default function GoogleCalendarEventEditor({ event, calendars, localDate, timezone, disabled, onSave, onDelete, onClose }) {
  const editing = Boolean(event?.eventId);
  const initialZone = event?.timeZone || timezone || 'UTC';
  const [draft, setDraft] = React.useState(() => ({
    calendarId: event?.calendarId || calendars[0]?.id || '',
    summary: event?.title || '',
    allDay: Boolean(event?.allDay),
    timeZone: initialZone,
    start: event?.start ? event.allDay ? event.start.slice(0, 10) : localInput(event.start, initialZone) : `${localDate}T09:00`,
    end: event?.end ? event.allDay ? event.end.slice(0, 10) : localInput(event.end, initialZone) : `${localDate}T10:00`,
    startOccurrence: event?.allDay ? '' : existingOccurrence(event?.start, initialZone),
    endOccurrence: event?.allDay ? '' : existingOccurrence(event?.end, initialZone),
  }));
  const [requestId] = React.useState(() => crypto.randomUUID());
  const returnFocus = React.useRef(document.activeElement);
  const [error, setError] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const change = (key, value) => {
    setDraft((previous) => ({ ...previous, [key]: value,
      ...(['start', 'end', 'timeZone'].includes(key) ? { startOccurrence: '', endOccurrence: '' } : {}),
    }));
    setError('');
  };
  const save = async (submitEvent) => {
    submitEvent.preventDefault();
    if (disabled) return;
    setError('');
    try {
      if (!draft.calendarId || !draft.summary.trim()) throw new Error('Choose a calendar and enter a title.');
      let start;
      let end;
      if (draft.allDay) {
        const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
        if (!validDate(draft.start) || !validDate(draft.end) || draft.end <= draft.start) throw new Error('End date must be after start date (exclusive).');
        start = { date: draft.start };
        end = { date: draft.end };
      } else {
        const instant = (value, occurrence) => {
          const [date, time = ''] = value.split('T');
          return zonedLocalTimeToTimestamp(date, time, draft.timeZone, occurrence);
        };
        start = { dateTime: instant(draft.start, draft.startOccurrence), timeZone: draft.timeZone };
        end = { dateTime: instant(draft.end, draft.endOccurrence), timeZone: draft.timeZone };
        if (Date.parse(end.dateTime) <= Date.parse(start.dateTime)) throw new Error('End time must be after start time.');
      }
      await onSave({ calendarId: draft.calendarId, requestId, event: { summary: draft.summary.trim(), start, end } });
    } catch (failure) {
      setError(failure.message);
    }
  };
  const remove = async () => {
    if (disabled) return;
    try { await onDelete(); } catch (failure) { setError(failure.message); }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !disabled) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (returnFocus.current?.isConnected && returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
        }} className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(94vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-zinc-100">
          <Dialog.Title className="text-lg font-semibold">{editing ? 'Edit Google event' : 'Create Google event'}</Dialog.Title>
          <Dialog.Description className="my-2 text-xs text-zinc-400">
            This changes Google Calendar only, not your local commitments.
            {event?.recurringEventId && ' Only this selected occurrence will change, not the recurring series.'}
          </Dialog.Description>
          <form onSubmit={save} className="space-y-3">
            <fieldset disabled={disabled} className="space-y-3">
              <label className="block text-sm">Destination calendar
                <select aria-label="Destination calendar" className={inputClass} value={draft.calendarId} disabled={editing || disabled} onChange={(e) => change('calendarId', e.target.value)}>
                  {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary || calendar.name || calendar.id}</option>)}
                </select>
              </label>
              <label className="block text-sm">Title<input aria-label="Event title" className={inputClass} value={draft.summary} onChange={(e) => change('summary', e.target.value)} maxLength={1024} required /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.allDay} onChange={(e) => {
                const allDay = e.target.checked;
                setDraft((previous) => ({ ...previous, allDay, start: allDay ? previous.start.slice(0, 10) : `${previous.start}T09:00`, end: allDay ? previous.end.slice(0, 10) : `${previous.end}T10:00`, startOccurrence: '', endOccurrence: '' }));
              }} />All-day event</label>
              {draft.allDay && <p className="text-xs text-zinc-400">End date is exclusive: for one day, choose the following date.</p>}
              {!draft.allDay && <label className="block text-sm">Timezone (IANA)<input aria-label="Event timezone" className={inputClass} value={draft.timeZone} onChange={(e) => change('timeZone', e.target.value)} required /></label>}
              {['start', 'end'].map((key) => <div key={key}>
                <label className="block text-sm">{key === 'start' ? 'Start' : 'End'}<input aria-label={`Event ${key}`} className={inputClass} type={draft.allDay ? 'date' : 'datetime-local'} step={draft.allDay ? undefined : 1} value={draft[key]} onChange={(e) => change(key, e.target.value)} required /></label>
                {!draft.allDay && <label className="block text-xs text-zinc-400">If this time repeats during a clock change, choose its occurrence:
                  <select aria-label={`${key} clock-change occurrence`} className={inputClass} value={draft[`${key}Occurrence`]} onChange={(e) => change(`${key}Occurrence`, e.target.value)}>
                    <option value="">Choose if time is ambiguous</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option>
                  </select>
                </label>}
              </div>)}
              <button className={buttonClass} type="submit">{editing ? 'Save Google event' : 'Create event'}</button>
              {editing && !confirmDelete && <button className={`${buttonClass} ml-2`} type="button" onClick={() => setConfirmDelete(true)}>Delete Google event</button>}
              {confirmDelete && <div role="alert" className="space-y-2 text-sm">
                <p>Delete this Google event{event?.recurringEventId ? ' occurrence only' : ''}? This cannot be undone.</p>
                <button className={buttonClass} type="button" onClick={remove}>Confirm delete</button>
                <button className={`${buttonClass} ml-2`} type="button" onClick={() => setConfirmDelete(false)}>Keep event</button>
              </div>}
            </fieldset>
            {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
            <button className={buttonClass} type="button" disabled={disabled} onClick={onClose}>Cancel</button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
