import { openai, MODELS } from './openai';
import { embeddingHelpers } from './embeddings';
import { journalHelpers } from '../supabase/journal';

export const insightsHelpers = {
  /**
   * Find relevant entries using semantic search
   * @param {string} userId - User ID
   * @param {string} query - The question or topic
   * @param {number} limit - How many entries to return
   * @returns {Promise<any[]>} - Relevant journal entries
   */
  async findRelevantEntries(userId, query, limit = 10) {
    // Generate embedding for the query
    const queryEmbedding = await embeddingHelpers.generateEmbedding(query);

    // Search for similar entries
    const results = await journalHelpers.semanticSearch(
      userId,
      queryEmbedding,
      limit
    );

    return results;
  },

  /**
   * Generate insights based on recent entries
   * @param {string} userId - User ID
   * @param {string} userSummary - Current user summary
   * @param {string} question - Optional specific question
   * @returns {Promise<{insights: string[], patterns: string[]}>}
   */
  async generateInsights(userId, userSummary, question = null) {
    if (!openai) {
      throw new Error('OpenAI client not initialized');
    }

    // Get recent entries or find relevant ones
    let entries;
    if (question) {
      entries = await this.findRelevantEntries(userId, question, 10);
    } else {
      entries = await journalHelpers. getEntries(userId, { limit: 10 });
    }

    if (entries.length === 0) {
      return {
        insights: ['Not enough data yet.  Keep journaling!'],
        patterns: [],
      };
    }

    // Prepare context
    const entriesContext = entries
      .map((e, i) => `Entry ${i + 1} (${new Date(e.created_at).toLocaleDateString()}):\n${e.summary || e.content. substring(0, 300)}`)
      .join('\n\n');

    const systemPrompt = `You are a thoughtful life coach and therapist analyzing someone's journal entries.

User Summary: 
${userSummary || 'No summary yet. '}

Your job is to: 
1. Identify meaningful patterns
2. Offer supportive, actionable insights
3. Highlight strengths and growth opportunities
4. Be warm, empathetic, and non-judgmental

${question ? `Answer this specific question: "${question}"` : 'Provide general insights about recent patterns.'}

Return a JSON object with:
{
  "insights": ["Array of 3-5 specific insights"],
  "patterns": ["Array of 2-3 patterns you noticed"]
}`;

    try {
      const response = await openai. chat.completions.create({
        model: MODELS.CHAT_ADVANCED,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Recent entries:\n\n${entriesContext}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format:  { type: 'json_object' },
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Error generating insights:', error);
      throw error;
    }
  },

  /**
   * Answer a specific question about the user's journal
   * @param {string} userId - User ID
   * @param {string} userSummary - Current user summary
   * @param {string} question - The question to answer
   * @returns {Promise<string>} - The answer
   */
  async answerQuestion(userId, userSummary, question) {
    const relevantEntries = await this.findRelevantEntries(userId, question, 5);

    if (relevantEntries.length === 0) {
      return "I don't have enough journal entries to answer that question yet.  Keep journaling!";
    }

    const entriesContext = relevantEntries
      .map((e, i) => `Entry ${i + 1} (${new Date(e.created_at).toLocaleDateString()}):\n${e.content}`)
      .join('\n\n');

    try {
      const response = await openai.chat.completions.create({
        model: MODELS. CHAT_ADVANCED,
        messages: [
          {
            role: 'system',
            content: `You are a thoughtful therapist helping someone understand patterns in their journal. 

User Summary:
${userSummary || 'No summary yet.'}

Answer their question based on the relevant journal entries.  Be specific, reference the entries, and offer supportive insights. `,
          },
          {
            role: 'user',
            content: `Question:  ${question}\n\nRelevant entries:\n\n${entriesContext}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error answering question:', error);
      throw error;
    }
  },
};