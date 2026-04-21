import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

const ALLOWED_TABLES = [
  'reflection_sessions',
  'reflection_messages',
  'user_profiles',
  'follow_up_queue',
  'growth_markers',
  'goals',
  'user_progress_events',
];

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    action,
    user_id,
    admin_secret,
    table,
    session_id,
    delete_id,
    delete_session_messages,
    target_date,
    delete_all,
  } = req.body || {};

  let isAuthorized = false;
  if (admin_secret && admin_secret === process.env.ADMIN_SECRET) {
    isAuthorized = true;
  } else {
    try {
      const authedId = await getAuthenticatedUserId(req);
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', authedId)
        .maybeSingle();
      if (profileData?.role === 'admin') isAuthorized = true;
    } catch (_e) {}
  }
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    if (action === 'data') {
      if (!table || !ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({ error: `table must be one of: ${ALLOWED_TABLES.join(', ')}` });
      }

      if (delete_id) {
        await supabase.from(table).delete().eq('id', delete_id);
        return res.status(200).json({ ok: true, deleted_id: delete_id, table });
      }

      if (delete_session_messages && session_id) {
        await supabase.from('reflection_messages').delete().eq('session_id', session_id);
        return res.status(200).json({ ok: true, deleted_session_messages: true, session_id });
      }

      let query;
      if (table === 'user_profiles') {
        query = supabase.from(table).select('*').eq('id', user_id);
      } else if (table === 'reflection_messages' && session_id) {
        query = supabase.from(table).select('*').eq('session_id', session_id).order('created_at', { ascending: true });
      } else {
        query = supabase.from(table).select('*').eq('user_id', user_id).order('created_at', { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true, data: data || [] });
    }

    if (action === 'upsert') {
      const UPSERT_ALLOWED = {
        reflection_sessions: ['tomorrow_commitment', 'commitment_minimum', 'commitment_stretch', 'commitment_score', 'is_complete', 'date'],
      };

      const { row_id, updates } = req.body || {};
      if (!row_id || !table || !updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: 'row_id, table, and updates are required' });
      }
      const allowedFields = UPSERT_ALLOWED[table];
      if (!allowedFields) {
        return res.status(400).json({ error: `upsert not supported for table: ${table}` });
      }

      const safeUpdates = {};
      for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          safeUpdates[key] = updates[key];
        }
      }
      if (Object.keys(safeUpdates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const { error: upsertError } = await supabase
        .from(table)
        .update(safeUpdates)
        .eq('id', row_id)
        .eq('user_id', user_id);
      if (upsertError) throw upsertError;
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset') {
      if (delete_all) {
        const { data: sessions } = await supabase
          .from('reflection_sessions')
          .select('id')
          .eq('user_id', user_id);

        const sessionIds = (sessions || []).map((s) => s.id);
        if (sessionIds.length > 0) {
          await supabase
            .from('reflection_messages')
            .delete()
            .in('session_id', sessionIds);
        }

        await supabase.from('reflection_sessions').delete().eq('user_id', user_id);
        await supabase.from('follow_up_queue').delete().eq('user_id', user_id);
        await supabase.from('growth_markers').delete().eq('user_id', user_id);

        return res.status(200).json({ ok: true, deleted_all: true, user_id });
      }

      const d = new Date();
      const date = target_date || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const { data: session } = await supabase
        .from('reflection_sessions')
        .select('id')
        .eq('user_id', user_id)
        .eq('date', date)
        .maybeSingle();

      if (!session) {
        return res.status(200).json({ ok: true, deleted_session_id: null, date, user_id, message: 'No session found for that date' });
      }

      await supabase.from('reflection_messages').delete().eq('session_id', session.id);
      await supabase.from('reflection_sessions').delete().eq('id', session.id);

      return res.status(200).json({ ok: true, deleted_session_id: session.id, date, user_id });
    }

    return res.status(400).json({ error: "action must be 'data', 'upsert', or 'reset'" });
  } catch (error) {
    console.error('admin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
