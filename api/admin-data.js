import { createClient } from '@supabase/supabase-js';

const ALLOWED_TABLES = [
  'reflection_sessions',
  'reflection_messages',
  'user_profiles',
  'follow_up_queue',
  'growth_markers',
  'goals',
  'user_progress_events',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    user_id,
    admin_secret,
    table,
    session_id,
    delete_id,
    delete_session_messages,
  } = req.body || {};

  if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  if (!table || !ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `table must be one of: ${ALLOWED_TABLES.join(', ')}` });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Delete a specific row
    if (delete_id) {
      await supabase.from(table).delete().eq('id', delete_id);
      return res.status(200).json({ ok: true, deleted_id: delete_id, table });
    }

    // Delete all messages for a session
    if (delete_session_messages && session_id) {
      await supabase.from('reflection_messages').delete().eq('session_id', session_id);
      return res.status(200).json({ ok: true, deleted_session_messages: true, session_id });
    }

    // Fetch rows
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
  } catch (error) {
    console.error('admin-data error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
