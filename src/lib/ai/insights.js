import { embeddingHelpers } from './embeddings';
import { journalHelpers } from '../supabase/journal';

export const insightsHelpers = {
  /**
   * Find relevant entries using semantic search
   */
  async findRelevantEntries(userId, query, limit = 10) {
    const queryEmbedding = await embeddingHelpers. generateEmbedding(query);
    const results = await journalHelpers. semanticSearch(userId, queryEmbedding, limit);
    return results;
  },

  /**
   * Generate insights based on recent entries
   */
  async generateInsights(userId, userSummary, question = null) {
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

    const entriesContext = entries
      .map((e, i) => `Entry ${i + 1} (${new Date(e.created_at).toLocaleDateString()}):\n${e.summary || e.content. substring(0, 300)}`)
      .join('\n\n');

    const response = await fetch('/api/generate-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON. stringify({
        userSummary:  userSummary || 'No summary yet.',
        recentEntries: entriesContext,
        question,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error. error || 'Failed to generate insights');
    }

    const data = await response.json();
    
    // The API returns { insights: "JSON string" }, we need to parse it
    if (typeof data.insights === 'string') {
      return JSON.parse(data.insights);
    }
    return data.insights;
  },

  /**
   * Answer a specific question about the user's journal
   */
  async answerQuestion(userId, userSummary, question) {
    return await this. generateInsights(userId, userSummary, question);
  },
};