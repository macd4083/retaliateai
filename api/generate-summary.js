import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Note: no VITE_ prefix for backend
});

export default async function handler(req, res) {
  // Only allow POST requests
  if (req. method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { content, mood_rating, tags } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Generate summary
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that creates concise, insightful summaries of journal entries.  Focus on emotional themes, key events, and personal growth.'
        },
        {
          role: 'user',
          content: `Summarize this journal entry in 2-3 sentences:\n\n${content}\n\nMood:  ${mood_rating}/10\nTags: ${tags?. join(', ') || 'none'}`
        }
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    const summary = completion. choices[0].message.content;

    return res.status(200).json({ summary });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate summary',
      details: error.message 
    });
  }
}