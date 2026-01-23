import { journalHelpers } from '../supabase/journal';
import { userProfileHelpers } from '../supabase/userProfile';

export const aiWorkflows = {
  async processNewEntry(userId, entryData) {
    try {
      // Step 1: Save the raw entry first
      const savedEntry = await journalHelpers.createEntry(userId, entryData);

      // Step 2: Generate embedding
      const embeddingResponse = await fetch('/api/generate-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entryData.content }),
      });

      if (!embeddingResponse.ok) {
        throw new Error('Failed to generate embedding');
      }

      const { embedding } = await embeddingResponse.json();

      // Step 3: Update entry with embedding
      await journalHelpers.updateEntry(savedEntry.id, { embedding });

      // Step 4: Get entry count to determine search strategy
      const allEntries = await journalHelpers.getEntries(userId);
      const entryCount = allEntries.length;
      
      // Adaptive search limit based on user history (reduced from 15 to 5 max)
      const searchLimit = entryCount < 10 ? Math.max(entryCount - 1, 3) : 5;

      // Step 5: Search for similar past entries
      const similarResponse = await fetch('/api/search-similar-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          embedding,
          limit: searchLimit,
        }),
      });

      if (!similarResponse.ok) {
        throw new Error('Failed to search similar entries');
      }

      const { entries: similarEntries } = await similarResponse.json();

      // Step 6: Enrich summaries with temporal context
      const enrichedSummaries = similarEntries.map(e => {
        const daysAgo = Math.floor((Date.now() - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24));
        return `[${daysAgo} days ago]: ${e.summary}`;
      });

      // Step 7: Get user profile
      let userProfile;
      try {
        const profile = await userProfileHelpers.getProfile(userId);
        userProfile = profile?.summary_text || 'No profile yet. This is a new user.';
      } catch (error) {
        userProfile = 'No profile yet. This is a new user.';
      }

      // Step 8: Analyze entry
      const analysisResponse = await fetch('/api/analyze-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_entry: entryData.content,
          past_summaries: enrichedSummaries,
          user_profile: userProfile,
        }),
      });

      if (!analysisResponse.ok) {
        throw new Error('Failed to analyze entry');
      }

      const analysis = await analysisResponse.json();

      // Step 9: Update entry with summary and insights
      const updatedEntry = await journalHelpers.updateEntry(savedEntry.id, {
        summary: analysis.summary,
        insights: analysis.insights,
      });

      // Step 10: Update user profile (now structured)
      if (analysis.updated_profile) {
        await userProfileHelpers.updateProfile(userId, analysis.updated_profile);
      }

      // Step 11: Auto-link entry to goals
      try {
        await fetch('/api/link-entry-to-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entry_id: savedEntry.id,
            entry_content: entryData.content,
            user_id: userId,
          }),
        });
      } catch (error) {
        console.error('Failed to link entry to goals:', error);
        // Don't fail the whole flow if this fails
      }

      // Step 12: Return entry with ephemeral follow-up questions AND goal suggestion
      return {
        entry: updatedEntry,
        followUpQuestions: analysis.follow_up_questions || null,
        suggestedGoal: analysis.suggested_goal || null,
      };
    } catch (error) {
      console.error('Error processing new entry:', error);
      throw error;
    }
  },
};