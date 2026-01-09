import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env. SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, title, description, why_it_matters, category } = req. body;

    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }

    // Create the goal in the database
    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id:  user_id,
        title:  title,
        description: description || null,
        category: category || null,
        status: 'active',
        // Store why_it_matters in a metadata field if your schema supports it,
        // otherwise it can be part of the description
        metadata: why_it_matters ?  { why_it_matters } :  null,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ goal: data });
  } catch (error) {
    console.error('Error creating goal:', error);
    return res.status(500).json({ error: 'Failed to create goal' });
  }
}