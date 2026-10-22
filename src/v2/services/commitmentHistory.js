import { supabase } from '../../lib/supabase/client';
import { TODAY_V2_TABLES } from '../today/types';

async function loadPages(table, columns, userId, dateColumn, endDate) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns)
      .eq('user_id', userId).lte(dateColumn, endDate)
      .order(dateColumn, { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export async function loadCommitmentHistory(userId, todayLocalDate) {
  const [fragments, legacySessions] = await Promise.all([
    loadPages(TODAY_V2_TABLES.COMMITMENT_FRAGMENTS, 'id, target_local_date, completion_state', userId, 'target_local_date', todayLocalDate),
    loadPages('reflection_sessions', 'id, date, commitment_score', userId, 'date', todayLocalDate),
  ]);
  return { fragments, legacySessions };
}
