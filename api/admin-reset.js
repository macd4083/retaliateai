import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, admin_secret, target_date, delete_all } = req.body || {};

  if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    if (delete_all) {
      // Nuke ALL data for the user
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

    // Delete a specific date's session (default: today's server local date)
    // Callers should always pass target_date (client's local YYYY-MM-DD) to avoid UTC offset issues
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
  } catch (error) {
    console.error('admin-reset error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
