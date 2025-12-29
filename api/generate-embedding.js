import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey:  process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body;  // ← CHANGED FROM content TO text

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const response = await openai. embeddings.create({
      model: 'text-embedding-3-small',
      input: text,  // ← CHANGED FROM content TO text
    });

    return res.status(200).json({ 
      embedding: response.data[0].embedding 
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate embedding',
      details:  error.message 
    });
  }
}