import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env. SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are analyzing a journal entry to detect goal-related activity. 

Given a journal entry and a list of the user's active goals, determine: 
1. Which goals (if any) are mentioned or related to this entry
2. The sentiment toward each goal (motivated, frustrated, neutral, etc.)
3. What progress was made (if any)
4. Any blockers or challenges mentioned
5. Suggested next actions

Return JSON: 
{
  "linked_goals": [
    {
      "goal_id": "uuid",
      "relevance_score": 0.85,
      "sentiment": "motivated",
      "progress_detected":  "Started working on the proposal",
      "blockers": ["Need more data"],
      "next_steps": ["Schedule meeting with stakeholders"]
    }
  ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { entry_id, entry_content, user_id } = req.body;

    // Get user's active goals
    const { data: goals, error: goalsError } = await supabase
      .from('goals')
      .select('id, title, description, success_criteria')
      .eq('user_id', user_id)
      .eq('status', 'active');

    if (goalsError) throw goalsError;

    if (! goals || goals.length === 0) {
      return res.status(200).json({ linked_goals: [] });
    }

    // Ask AI to analyze
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content:  SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            entry: entry_content,
            active_goals: goals,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    // Store links in database
    for (const link of analysis.linked_goals) {
      await supabase. from('goal_journal_links').upsert({
        goal_id: link.goal_id,
        journal_entry_id: entry_id,
        relevance_score: link.relevance_score,
        sentiment: link.sentiment,
        progress_detected: link.progress_detected,
      });

      // Update goal's last activity
      await supabase
        .from('goals')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', link.goal_id);
    }

    return res.status(200).json(analysis);
  } catch (error) {
    console.error('Error linking entry to goals:', error);
    return res.status(500).json({ error: 'Failed to link entry to goals' });
  }
}