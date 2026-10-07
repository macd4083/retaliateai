import { getTodayV2WeekdayIndex, isTodayV2HabitScheduledForDate } from './model';

export function normalizeHabitRecurrence(habit = {}) {
  const planning_mode = habit.planning_mode ?? 'manual';
  if (!['manual', 'automatic'].includes(planning_mode)) {
    throw new Error('Choose manual or automatic habit planning.');
  }
  const source = habit.schedule_times ?? {};
  if (!source || Array.isArray(source) || typeof source !== 'object') {
    throw new Error('Habit schedule times must be a weekday object.');
  }
  const schedule_times = {};
  for (const [weekday, entry] of Object.entries(source)) {
    if (!/^[0-6]$/.test(weekday) || !entry || typeof entry !== 'object' || Array.isArray(entry)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time || '')
      || !Number.isInteger(entry.duration_minutes) || entry.duration_minutes < 1 || entry.duration_minutes > 1440
      || !['earlier', 'later'].includes(entry.occurrence)) {
      throw new Error('Each weekday needs a valid time, duration (1–1440 minutes), and earlier/later occurrence.');
    }
    schedule_times[weekday] = {
      time: entry.time, duration_minutes: entry.duration_minutes, occurrence: entry.occurrence,
    };
  }
  if (planning_mode === 'automatic'
    && (habit.schedule_weekdays || []).some((weekday) => !schedule_times[weekday])) {
    throw new Error('Set a time for every selected automatic weekday.');
  }
  return { planning_mode, schedule_times };
}

export function getHabitScheduleForDate(habit, localDate) {
  if (!isTodayV2HabitScheduledForDate(habit, localDate)) return null;
  return habit.schedule_times?.[getTodayV2WeekdayIndex(localDate)] || null;
}
