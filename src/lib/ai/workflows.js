import { embeddingHelpers } from './embeddings';
import { summaryHelpers } from './summaries';
import { journalHelpers } from '../supabase/journal';
import { userProfileHelpers } from '../supabase/userProfile';

export const aiWorkflows = {
  async processNewEntry(userId, entryData) {
    try {
      // Step 1: Save the raw entry first
      const savedEntry = await journalHelpers.createEntry(userId, entryData);

      // Step 2: Generate summary and embedding in parallel
      const [entrySummary, embedding] = await Promise.all([
        summaryHelpers.summarizeEntry(entryData.content),
        embeddingHelpers. generateEmbedding(entryData.content),
      ]);

      // Step 3: Update the entry with summary and embedding
      const updatedEntry = await journalHelpers.updateEntry(savedEntry.id, {
        summary: entrySummary,
        embedding,
      });

      // Step 4: Update user's rolling summary (async, don't wait)
      this.updateUserSummaryAsync(userId, entryData.content);

      return updatedEntry;
    } catch (error) {
      console.error('Error processing new entry:', error);
      throw error;
    }
  },

  async updateUserSummaryAsync(userId, newEntryContent) {
    try {
      const profile = await userProfileHelpers.getProfile(userId);
      const currentSummary = profile?. summary_text || '';

      const { summary, changes } = await summaryHelpers.updateUserSummary(
        currentSummary,
        newEntryContent
      );

      await userProfileHelpers.updateSummary(userId, summary);

      console.log('User summary updated.  Changes:', changes);
    } catch (error) {
      console.error('Error updating user summary:', error);
    }
  },
};