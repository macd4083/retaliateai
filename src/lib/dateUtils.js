/**
 * Returns the current local calendar date as YYYY-MM-DD.
 * Uses local time methods (getFullYear, getMonth, getDate) NOT toISOString()
 * to avoid the UTC offset bug where toISOString() returns tomorrow's date
 * for users in negative UTC offset timezones before midnight UTC.
 * @param {number} offsetDays - Optional offset (e.g. -1 for yesterday, +3 for 3 days from now)
 */
export function localDateStr(offsetDays = 0) {
  const d = new Date();
  if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
