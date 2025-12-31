import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env. SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are analyzing journal entries to detect meaningful patterns. 

Given the user's recent journal entries (last 30 days), identify: 
1. **Recurring themes** (mentioned 3+ times)
2. **Emotional patterns** (consistent feelings)
3. **Behavioral patterns** (repeated actions/habits)
4. **Blockers** (obstacles mentioned multiple times)
5. **Strengths** (positive traits shown consistently)

For each pattern, determine:
- Trend (increasing/stable/decreasing)
- Sentiment (positive/neutral/negative)
- Actionable recommendation

Return JSON: 
{
  "patterns": [
    {
      "type": "theme|emotion|behavior|blocker|strength",
      "name": "work-stress",
      "description": "Brief description",
      "occurrence_count": 8,
      "trend": "increasing",
      "sentiment":  -0.6,
      "recommendation": "Consider setting boundaries or delegating tasks"
    }
  ],
  "overall_summary": "Brief summary of user's current state",
  "top_3_actions": ["Action 1", "Action 2", "Action 3"]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id } = req.body;

    // Get last 30 days of entries
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: entries, error:  entriesError } = await supabase
      .from('journal_entries')
      .select('id, content, summary, created_at')
      .eq('user_id', user_id)
      .gte('created_at', thirtyDaysAgo. toISOString())
      .order('created_at', { ascending:  false });

    if (entriesError) throw entriesError;

    if (! entries || entries.length === 0) {
      return res.status(200).json({ 
        patterns: [],
        message: 'Not enough data yet.  Keep journaling!'
      });
    }

    // Prepare context for AI
    const entriesContext = entries.map(e => ({
      date: e.created_at,
      summary: e.summary || e.content. substring(0, 200),
    }));

    // Ask AI to detect patterns
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content:  SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ entries: entriesContext }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    // Store or update patterns in database
    for (const pattern of analysis.patterns) {
      // Check if pattern already exists
      const { data: existing } = await supabase
        . from('user_patterns')
        .select('id, occurrence_count')
        .eq('user_id', user_id)
        .eq('pattern_name', pattern.name)
        .single();

      if (existing) {
        // Update existing pattern
        await supabase
          . from('user_patterns')
          .update({
            occurrence_count: pattern.occurrence_count,
            last_detected: new Date().toISOString(),
            trend: pattern.trend,
            sentiment_average: pattern.sentiment,
            ai_recommendation: pattern.recommendation,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing. id);
      } else {
        // Create new pattern
        await supabase
          .from('user_patterns')
          .insert({
            user_id,
            pattern_type: pattern.type,
            pattern_name: pattern.name,
            occurrence_count: pattern.occurrence_count,
            trend: pattern.trend,
            sentiment_average: pattern.sentiment,
            ai_recommendation: pattern.recommendation,
          });
      }
    }

    return res.status(200).json(analysis);
  } catch (error) {
    console.error('Error detecting patterns:', error);
    return res.status(500).json({ error: 'Failed to detect patterns' });
  }
}