import OpenAI from 'openai';

const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

if (!apiKey) {
  console.warn('OpenAI API key not found. AI features will not work.');
}

export const openai = apiKey ? new OpenAI({
  apiKey,
  dangerouslyAllowBrowser:  true, // Only for development - move to backend in production
}) : null;

// Models to use
export const MODELS = {
  EMBEDDING:  'text-embedding-3-small', // 1536 dimensions, cheap
  CHAT: 'gpt-4o-mini', // Fast and cheap for summaries
  CHAT_ADVANCED: 'gpt-4o', // For complex insights
};