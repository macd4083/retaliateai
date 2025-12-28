import { openai, MODELS } from './openai';

export const summaryHelpers = {
  /**
   * Generate a summary for a journal entry
   * @param {string} content - The journal entry content
   * @returns {Promise<string>} - Short summary
   */
  async summarizeEntry(content) {
    if (!openai) {
      throw new Error('OpenAI client not initialized');
    }

    try {
      const response = await openai.chat.completions.create({
        model: MODELS. CHAT,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that creates concise summaries of journal entries.  Focus on the main themes, emotions, and key events.  Keep it under 100 words.',
          },
          {
            role:  'user',
            content:  `Summarize this journal entry:\n\n${content}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 150,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error summarizing entry:', error);
      throw error;
    }
  },

  /**
   * Update user's rolling summary with new entry
   * @param {string} currentSummary - Current user summary (or null if first time)
   * @param {string} newEntry - New journal entry content
   * @returns {Promise<{summary: string, changes: string[]}>} - Updated summary and what changed
   */
  async updateUserSummary(currentSummary, newEntry) {
    if (!openai) {
      throw new Error('OpenAI client not initialized');
    }

    const isFirstEntry = ! currentSummary || currentSummary.trim().length === 0;

    const systemPrompt = `You are a thoughtful therapist analyzing a person's journal entries. 

Your job is to maintain a concise, evolving summary that captures:
1.  Emotional baseline
2. Recurring emotional triggers
3. Core values and motivations
4. Current goals
5. Strengths
6. Vulnerabilities
7. Recent changes or trends
8. Relationship patterns
9. Behavioral patterns
10. Key insights

${isFirstEntry ? 'This is the first entry. Create an initial summary.' : 'Update the existing summary ONLY if the new entry contains meaningful new information.'}

Keep the summary under 500 words.  Focus on patterns, not events.

Return a JSON object with:
{
  "summary": "The updated summary text",
  "changes": ["List of what changed", "or empty array if nothing significant"]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: MODELS.CHAT,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role:  'user',
            content:  isFirstEntry
              ? `Create initial summary from this journal entry:\n\n${newEntry}`
              : `Current summary:\n${currentSummary}\n\nNew entry:\n${newEntry}`,
          },
        ],
        temperature: 0.5,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return {
        summary: result.summary,
        changes: result.changes || [],
      };
    } catch (error) {
      console.error('Error updating user summary:', error);
      throw error;
    }
  },
};