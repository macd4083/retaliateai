import { supabase } from '../../lib/supabase/client';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import { addDaysToLocalDate } from '../today/model';
import { getScheduleDateBounds } from '../today/scheduling';
import { syncSavedSchedule } from './calendarScheduleSync';

export function isMissingScheduleSchema(error) {
  if (['42501', 'PGRST301', 'PGRST302'].includes(error?.code)
    || /permission denied|not authorized|JWT|access denied/i.test(error?.message || '')) return false;
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)
    || /schema cache|does not exist|could not find.*(?:table|function)/i.test(error?.message || '');
}

export function normalizeSavedSchedule(row) {
  return {
    ...row,
    source_type: row.commitment_fragment_id ? 'action' : row.habit_definition_id ? 'habit' : row.source_type,
    source_id: row.commitment_fragment_id || row.habit_definition_id || row.source_id,
  };
}

export async function loadSchedules(userId, todayLocalDate, tomorrowLocalDate, timezoneName = 'UTC') {
  if (!ENABLE_TODAY_V2_SCHEDULER) {
    return { todaySchedules: [], tomorrowSchedules: [], scheduleAvailable: false, scheduleDiagnostic: null };
  }
  try {
    const { data, error } = await supabase.from('today_v2_schedule_blocks').select('*')
      .eq('user_id', userId).gte('target_local_date', addDaysToLocalDate(todayLocalDate, -2)).lte('target_local_date', tomorrowLocalDate);
    if (error) throw error;
    const rows = (data || []).map(normalizeSavedSchedule);
    const schedulesForDate = (localDate) => {
      const bounds = getScheduleDateBounds(localDate, timezoneName);
      return rows.filter((row) => row.target_local_date === localDate
        || (row.target_local_date < localDate
          && Date.parse(row.starts_at) < Date.parse(bounds.ends_at)
          && Date.parse(row.ends_at) > Date.parse(bounds.starts_at)));
    };
    return {
      todaySchedules: schedulesForDate(todayLocalDate),
      tomorrowSchedules: schedulesForDate(tomorrowLocalDate),
      scheduleAvailable: true,
      scheduleDiagnostic: null,
    };
  } catch (error) {
    return {
      todaySchedules: [], tomorrowSchedules: [], scheduleAvailable: false,
      scheduleDiagnostic: { code: error.code || 'SCHEDULE_LOAD_FAILED', message: error.message || 'Scheduling unavailable' },
    };
  }
}

export async function replaceSchedule({ targetLocalDate, timezoneName, blocks, userId }) {
  const { data, error } = await supabase.rpc('today_v2_replace_schedule', {
    p_target_local_date: targetLocalDate,
    p_timezone_name: timezoneName,
    p_blocks: blocks.map((block) => ({
      ...(block.source_type === 'action'
        ? { commitment_fragment_id: block.source_id }
        : { habit_definition_id: block.source_id }),
      starts_at: block.starts_at,
      ends_at: block.ends_at,
    })),
  });
  if (error) throw error;
  await syncSavedSchedule({ userId, targetLocalDate });
  return (data || []).map(normalizeSavedSchedule);
}

export async function updateDaySchedule({ targetLocalDate, timezoneName, sourceType, sourceId, startsAt, endsAt, userId }) {
  if (!['action', 'habit'].includes(sourceType)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId || '')) {
    throw new Error('A persisted action or habit UUID is required');
  }
  if (startsAt === undefined || endsAt === undefined || (startsAt === null) !== (endsAt === null)) {
    throw new Error('Both schedule times or two explicit nulls are required');
  }
  const { data, error } = await supabase.rpc('today_v2_update_day_schedule', {
    p_target_local_date: targetLocalDate,
    p_timezone_name: timezoneName,
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  if (error) throw error;
  await syncSavedSchedule({ userId, targetLocalDate });
  return (data || []).map(normalizeSavedSchedule);
}

export const upsertDaySchedule = updateDaySchedule;

export async function removeDaySchedule(identity) {
  return updateDaySchedule({ ...identity, startsAt: null, endsAt: null });
}
