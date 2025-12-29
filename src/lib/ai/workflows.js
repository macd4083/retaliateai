import { journalHelpers } from '../supabase/journal';
import { userProfileHelpers } from '../supabase/userProfile';

export const aiWorkflows = {
  async processNewEntry(userId, entryData) {
    try {
      // Step 1: Save the raw entry first
      const savedEntry = await journalHelpers.createEntry(userId, entryData);

      // Step 2: Generate embedding
      const embeddingResponse = await fetch('/api/generate-embedding', {
        method:  'POST',
        headers:  { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entryData.content }),
      });

      if (!embeddingResponse.ok) {
        throw new Error('Failed to generate embedding');
      }

      const { embedding } = await embeddingResponse.json();

      // Step 3: Update entry with embedding
      await journalHelpers.updateEntry(savedEntry.id, { embedding });

      // Step 4: Search for similar past entries
      const similarResponse = await fetch('/api/search-similar-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          embedding,
          limit: 15,
        }),
      });

      if (!similarResponse.ok) {
        throw new Error('Failed to search similar entries');
      }

      const { entries:  similarEntries } = await similarResponse.json();

      // Step 5: Get user profile
      let userProfile;
      try {
        const profile = await userProfileHelpers.getProfile(userId);
        userProfile = profile?. summary_text || 'No profile yet.  This is a new user.';
      } catch (error) {
        userProfile = 'No profile yet. This is a new user.';
      }

      // Step 6: Analyze entry
      const analysisResponse = await fetch('/api/analyze-entry', {
        method: 'POST',
        headers: { 'Content-Type':  'application/json' },
        body: JSON.stringify({
          new_entry:  entryData. content,
          past_summaries: similarEntries.map(e => e.summary).filter(Boolean),
          user_profile: userProfile,
        }),
      });

      if (!analysisResponse. ok) {
        throw new Error('Failed to analyze entry');
      }

      const analysis = await analysisResponse.json();

      // Step 7: Update entry with summary and insights
      const updatedEntry = await journalHelpers.updateEntry(savedEntry.id, {
        summary: analysis.summary,
        insights: analysis.insights,
      });

      // Step 8: Update user profile if needed
      if (analysis.updated_profile) {
        await userProfileHelpers.updateSummary(userId, analysis.updated_profile);
      }

      // Step 9: Return entry with ephemeral follow-up questions
      return {
        entry: updatedEntry,
        followUpQuestions: analysis. follow_up_questions || null,
      };
    } catch (error) {
      console.error('Error processing new entry:', error);
      throw error;
    }
  },
};