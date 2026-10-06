import { addDaysToLocalDate, normalizeTodayV2Text } from './model';

export const SCHEDULE_SNAP_MINUTES = 15;
export const DEFAULT_SCHEDULE_MINUTES = 30;

export function createActionIdentity(text, persistedId = null) {
  return { key: crypto.randomUUID(), text, persistedId };
}

// Re-splitting only retains unambiguous exact matches. Explicit edits use the key.
export function reconcileActionIdentities(previous, texts, { allowSingleEdit = false } = {}) {
  const normalized = texts.map(normalizeTodayV2Text);
  const used = new Set();
  const next = normalized.map((text) => {
    const matches = previous.filter((item) => normalizeTodayV2Text(item.text) === text);
    if (matches.length !== 1 || normalized.filter((value) => value === text).length !== 1) return null;
    used.add(matches[0].key);
    return { ...matches[0], text };
  });
  const missing = next.map((item, index) => item ? -1 : index).filter((index) => index !== -1);
  const unused = previous.filter((item) => !used.has(item.key));
  if (allowSingleEdit && texts.length === previous.length && missing.length === 1 && unused.length === 1) {
    next[missing[0]] = { ...unused[0], text: normalized[missing[0]] };
  }
  return next.map((item, index) => item || createActionIdentity(normalized[index]));
}

function localParts(timestamp, timezoneName) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneName, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

export function zonedLocalTimeToTimestamp(localDate, localTime, timezoneName, disambiguation) {
  const wall = `${localDate}T${localTime.length === 5 ? `${localTime}:00` : localTime}`;
  const naive = Date.parse(`${wall}Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== wall) {
    throw new Error('Invalid local date or time');
  }
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = naive + hours * 3600000;
    offsets.add(Date.parse(`${localParts(instant, timezoneName)}Z`) - instant);
  }
  const candidates = [...offsets].map((offset) => naive - offset)
    .filter((instant) => localParts(instant, timezoneName) === wall).sort((a, b) => a - b);
  if (!candidates.length) throw new Error('This local time does not exist (DST gap)');
  if (candidates.length > 1 && !['earlier', 'later'].includes(disambiguation)) {
    throw new Error('Ambiguous local time: choose earlier or later');
  }
  return new Date(disambiguation === 'later' ? candidates.at(-1) : candidates[0]).toISOString();
}

export function getScheduleDateBounds(localDate, timezoneName) {
  return {
    starts_at: zonedLocalTimeToTimestamp(localDate, '00:00', timezoneName, 'earlier'),
    ends_at: zonedLocalTimeToTimestamp(addDaysToLocalDate(localDate, 1), '00:00', timezoneName, 'earlier'),
  };
}

export function snapScheduleMinutes(minutes, increment = SCHEDULE_SNAP_MINUTES) {
  return Math.round(minutes / increment) * increment;
}

export function normalizeScheduleBlock(block) {
  const start = Date.parse(block.starts_at);
  const end = block.ends_at == null ? start + DEFAULT_SCHEDULE_MINUTES * 60000 : Date.parse(block.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000) {
    throw new Error('Schedule duration must be greater than zero and at most 24 hours');
  }
  return { ...block, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
}

export function scheduleBlocksOverlap(left, right) {
  return Date.parse(left.starts_at) < Date.parse(right.ends_at)
    && Date.parse(right.starts_at) < Date.parse(left.ends_at);
}

export function layoutScheduleBlocks(blocks) {
  const lanes = [];
  return [...blocks].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map((block) => {
    let lane = lanes.findIndex((end) => end <= Date.parse(block.starts_at));
    if (lane === -1) lane = lanes.length;
    lanes[lane] = Date.parse(block.ends_at);
    return { ...block, lane };
  });
}
