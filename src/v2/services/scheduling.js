import { supabase } from '../../lib/supabase/client';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import { addDaysToLocalDate } from '../today/model';
import { getScheduleDateBounds } from '../today/scheduling';

export function isMissingScheduleSchema(error) {
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
      .eq('user_id', userId).gte('target_local_date', addDaysToLocalDate(todayLocalDate, -1)).lte('target_local_date', tomorrowLocalDate);
    if (error) throw error;
    const rows = (data || []).map(normalizeSavedSchedule);
    return {
      todaySchedules: rows.filter((row) => row.target_local_date === todayLocalDate
        || (row.target_local_date === addDaysToLocalDate(todayLocalDate, -1)
          && Date.parse(row.ends_at) > Date.parse(getScheduleDateBounds(todayLocalDate, timezoneName).starts_at))),
      tomorrowSchedules: rows.filter((row) => row.target_local_date === tomorrowLocalDate
        || (row.target_local_date === todayLocalDate
          && Date.parse(row.ends_at) > Date.parse(getScheduleDateBounds(tomorrowLocalDate, timezoneName).starts_at))),
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

export async function replaceSchedule({ targetLocalDate, timezoneName, blocks }) {
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
  return (data || []).map(normalizeSavedSchedule);
}
