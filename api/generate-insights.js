import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process. env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userSummary, recentEntries, question } = req.body;

    if (!userSummary && !recentEntries) {
      return res.status(400).json({ error: 'User summary or recent entries required' });
    }

    const systemPrompt = question 
      ? 'You are a thoughtful AI assistant helping someone understand their journal entries. Answer their question based on their journal patterns.'
      : 'You are a thoughtful AI assistant analyzing journal entries.  Provide 3-5 meaningful insights about patterns, growth opportunities, or things to celebrate.';

    const userPrompt = question
      ? `User summary:\n${userSummary}\n\nRecent entries:\n${recentEntries}\n\nQuestion: ${question}`
      : `User summary:\n${userSummary}\n\nRecent entries:\n${recentEntries}\n\nProvide insights. `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return res.status(200).json({ 
      insights: response.choices[0].message.content.trim()
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate insights',
      details: error.message 
    });
  }
}