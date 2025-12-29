// Don't export openai client anymore - it's backend only
export { embeddingHelpers } from './embeddings';
export { summaryHelpers } from './summaries';
export { insightsHelpers } from './insights';
export { aiWorkflows } from './workflows';

// Export model names for reference (not the actual OpenAI client)
export const MODELS = {
  EMBEDDING: 'text-embedding-3-small',
  CHAT: 'gpt-4o-mini',
  CHAT_ADVANCED:  'gpt-4o',
};