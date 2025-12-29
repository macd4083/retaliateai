import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { currentSummary, newEntry } = req.body;

    if (! newEntry) {
      return res.status(400).json({ error: 'New entry is required' });
    }

    const isFirstEntry = ! currentSummary || currentSummary.trim().length === 0;

    const systemPrompt = `You are a thoughtful therapist analyzing a person's journal entries. 

Your job is to maintain a concise, evolving summary that captures: 
1. Emotional baseline
2. Recurring emotional triggers
3. Core values and motivations
4. Current goals
5. Strengths
6. Vulnerabilities
7. Recent changes or trends
8. Relationship patterns
9. Behavioral patterns
10. Key insights

${isFirstEntry ? 'This is the first entry. Create an initial summary.' : 'Update the existing summary ONLY if the new entry contains meaningful new information. '}

Keep the summary under 500 words.  Focus on patterns, not events. 

Return a JSON object with:
{
  "summary": "The updated summary text",
  "changes":  ["List of what changed", "or empty array if nothing significant"]
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: isFirstEntry
            ? `Create initial summary from this journal entry:\n\n${newEntry}`
            : `Current summary:\n${currentSummary}\n\nNew entry:\n${newEntry}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 800,
      response_format: { type:  'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content);
    return res.status(200).json({
      summary: result.summary,
      changes: result.changes || [],
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return res.status(500).json({ 
      error: 'Failed to update user summary',
      details: error.message 
    });
  }
}