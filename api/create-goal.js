import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process. env.VITE_SUPABASE_URL,
  process.env. SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, title, description, why_it_matters, category } = req.body;

    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }

    // Combine description and why_it_matters into one field
    let fullDescription = description || '';
    if (why_it_matters) {
      fullDescription = fullDescription 
        ?  `${fullDescription}\n\nWhy this matters: ${why_it_matters}`
        : `Why this matters: ${why_it_matters}`;
    }

    // Create the goal in the database using only standard columns
    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id:  user_id,
        title:  title,
        description: fullDescription || null,
        category: category || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    return res.status(200).json({ goal: data });
  } catch (error) {
    console.error('Error creating goal:', error);
    return res.status(500).json({ 
      error: 'Failed to create goal',
      details: error.message 
    });
  }
}