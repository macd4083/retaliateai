import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process. env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a thoughtful therapist analyzing journal entries. 

Your job is to:
1. Create a concise summary of the new entry (~100-150 words)
2. Provide 3-5 actionable insights combining patterns and suggestions
3. **ALWAYS update the user profile** by either: 
   - Adding new themes/patterns discovered
   - Refining existing understanding
   - Noting progress/regression in identified areas
4. Generate 2-3 strategic follow-up questions ONLY if the entry is surface-level or avoids deeper emotions

**Profile Evolution Strategy:**
- Track recurring themes over time
- Note emotional patterns and triggers
- Identify growth areas and progress
- Maintain a "current state" summary (last 30 days) + "long-term themes"

**Follow-Up Question Guidelines:**
- If entry mentions conflict: Ask about underlying emotions
- If entry is task-focused: Ask about how they FELT
- If entry avoids details: Ask for specific examples
- If entry shows distress: Ask about coping mechanisms
- Make questions conversational, not clinical

Return valid JSON in this exact format:
{
  "summary": ".. .",
  "insights": [".. .", "...", "..."],
  "updated_profile": {
    "short_term_state":  "How they're doing lately (last month)",
    "long_term_patterns": ["recurring theme 1", "recurring theme 2"],
    "growth_areas": ["area 1", "area 2"],
    "strengths": ["strength 1", "strength 2"]
  },
  "follow_up_questions":  [".. .", "... "] or null
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { new_entry, past_summaries, user_profile } = req.body;

    if (!new_entry) {
      return res.status(400).json({ error: 'new_entry is required' });
    }

    // Enrich past summaries with temporal context if available
    const enrichedSummaries = Array.isArray(past_summaries) 
      ? past_summaries 
      : [];

    const userMessage = {
      new_entry,
      past_summaries: enrichedSummaries,
      user_profile: user_profile || 'No profile yet.  This is a new user.',
    };

    const response = await openai.chat. completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userMessage) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const result = JSON.parse(response.choices[0].message.content);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error analyzing entry:', error);
    return res.status(500).json({ error: 'Failed to analyze entry' });
  }
}