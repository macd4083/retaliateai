import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env. SUPABASE_SERVICE_ROLE_KEY // Use service role for backend
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, embedding, limit = 15 } = req.body;

    if (!user_id || !embedding) {
      return res.status(400).json({ error: 'user_id and embedding are required' });
    }

    const { data, error } = await supabase. rpc('match_journal_entries', {
      query_embedding:  embedding,
      match_user_id: user_id,
      match_count: limit,
    });

    if (error) throw error;

    return res.status(200).json({ entries: data });
  } catch (error) {
    console.error('Error searching entries:', error);
    return res.status(500).json({ error: 'Failed to search entries' });
  }
}