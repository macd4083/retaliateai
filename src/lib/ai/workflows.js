import { journalHelpers } from '../supabase/journal';
import { userProfileHelpers } from '../supabase/userProfile';

export const aiWorkflows = {
  // EXISTING FUNCTION - KEEP AS IS
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

  // NEW FUNCTION - Process Clarity Session
  async processClaritySession(userId, clarityData) {
    try {
      const {
        goal_text,
        goal_id, // If linked to existing goal
        stage_responses, // Array of { stage, question, answer, attempt }
      } = clarityData;

      // Step 1: Compile the full clarity session into journal entry format
      const fullContent = this.compileClarityContent(goal_text, stage_responses);

      // Step 2: Create journal entry with clarity metadata
      const entryData = {
        title: `Clarity Session: ${goal_text}`,
        content: fullContent,
      };

      const savedEntry = await journalHelpers.createEntry(userId, entryData);

      // Step 3: Generate embedding (same as journal)
      const embeddingResponse = await fetch('/api/generate-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullContent }),
      });

      if (!embeddingResponse.ok) {
        throw new Error('Failed to generate embedding');
      }

      const { embedding } = await embeddingResponse.json();

      // Step 4: Update entry with embedding
      await journalHelpers.updateEntry(savedEntry.id, { embedding });

      // Step 5: Search for similar past entries
      const allEntries = await journalHelpers.getEntries(userId);
      const searchLimit = allEntries.length < 10 ? Math.max(allEntries.length - 1, 3) : 5;

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

      // Step 6: Enrich with temporal context
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

      // Step 8: Analyze with CLARITY-SPECIFIC prompt
      const analysisResponse = await fetch('/api/analyze-clarity-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_text,
          stage_responses,
          full_content: fullContent,
          past_summaries: enrichedSummaries,
          user_profile: userProfile,
        }),
      });

      if (!analysisResponse.ok) {
        throw new Error('Failed to analyze clarity session');
      }

      const analysis = await analysisResponse.json();

      // Step 9: Update entry with structured clarity data
      const updatedEntry = await journalHelpers.updateEntry(savedEntry.id, {
        summary: analysis.summary,
        insights: analysis.insights,
      });

      // Step 10: Update user profile with clarity insights
      if (analysis.updated_profile) {
        await userProfileHelpers.updateProfile(userId, analysis.updated_profile);
      }

      // Step 11: Create or update linked goal if needed
      if (goal_id && analysis.clarity_map) {
        // Update existing goal (implement later)
        console.log('Would update goal:', goal_id);
      } else if (analysis.should_create_goal && analysis.suggested_goal) {
        // Create new goal (implement later)
        console.log('Would create goal:', analysis.suggested_goal);
      }

      return {
        entry: updatedEntry,
        clarity_map: analysis.clarity_map,
        suggested_actions: analysis.suggested_actions,
      };

    } catch (error) {
      console.error('Error processing clarity session:', error);
      throw error;
    }
  },

  // Helper: Compile clarity responses into readable journal entry
  compileClarityContent(goal_text, stage_responses) {
    let content = `CLARITY SESSION: ${goal_text}\n\n`;
    content += `Date: ${new Date().toLocaleDateString()}\n`;
    content += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const stageNames = {
      vision: '🎯 VISION: Where I\'m Going',
      pain: '🔥 PAIN: What I\'m Running From',
      why: '❤️ WHY: My Core Motivation',
      identity: '🧬 IDENTITY: Who I\'m Becoming',
      obstacles: '🚧 OBSTACLES: What\'s in the Way',
      roadmap: '📍 ROADMAP: The Path Forward',
      commitment: '✅ COMMITMENT: My Next Step',
    };

    stage_responses.forEach(response => {
      content += `${stageNames[response.stage]}\n\n`;
      content += `Q: ${response.question}\n\n`;
      content += `A: ${response.answer}\n\n`;
      
      if (response.attempt > 1) {
        content += `(Explored deeper with ${response.attempt - 1} follow-up question(s))\n\n`;
      }
      
      content += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    });

    return content;
  },
};