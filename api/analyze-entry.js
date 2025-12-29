import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a thoughtful therapist analyzing journal entries. 

Your job is to:
1. Create a concise summary of the new entry (~100-150 words)
2. Identify patterns across all entries provided
3. Provide 3-5 actionable insights
4. Update the user profile ONLY if meaningful new information appears
5. Suggest 2-3 follow-up questions ONLY if the entry feels incomplete or surface-level

Return valid JSON in this exact format:
{
  "summary": ".. .",
  "insights": [".. .", "... "],
  "patterns": [".. .", "..."],
  "updated_profile": "..." or null,
  "follow_up_questions": [".. .", "..."] or null
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

    // Build the context
    const userMessage = {
      new_entry,
      past_summaries:  past_summaries || [],
      user_profile: user_profile || 'No profile yet.  This is a new user.',
    };

    const response = await openai.chat.completions.create({
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