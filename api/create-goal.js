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

    console.log('Received goal creation request:', { user_id, title, category });

    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }

    // Combine description and why_it_matters
    let fullDescription = description || '';
    if (why_it_matters) {
      fullDescription = fullDescription 
        ? `${fullDescription}\n\nWhy this matters: ${why_it_matters}`
        : `Why this matters: ${why_it_matters}`;
    }

    // Create the goal - matches your schema exactly
    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id:  user_id,
        title:  title,
        description: fullDescription || null,
        category: category || null,
        status: 'active',
        // target_date, created_at, updated_at, completed_at will be handled by database defaults
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      
      return res.status(500).json({ 
        error: 'Database error',
        message: error.message,
        details: error.details,
        hint: error.hint
      });
    }

    console.log('Goal created successfully:', data);
    return res.status(200).json({ goal: data });
    
  } catch (error) {
    console.error('Unexpected error creating goal:', error);
    return res.status(500).json({ 
      error: 'Failed to create goal',
      message:  error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack :  undefined
    });
  }
}