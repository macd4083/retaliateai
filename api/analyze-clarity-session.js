import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CLARITY_ANALYSIS_PROMPT = `You are analyzing a completed Clarity Session where a user went deep on understanding their goals.

You will receive:
- Their goal
- 7 stages of deep questioning (vision, pain, why, identity, obstacles, roadmap, commitment)
- Their past journal summaries (for context)
- Their user profile

YOUR JOB:
1. Create a comprehensive summary (200-250 words) that captures:
   - Their true motivation (core why)
   - The tension between their vision and current pain
   - Who they need to become
   - Their main obstacle
   - Their commitment

2. Extract structured "Clarity Map" data

3. Provide 3-5 actionable insights that connect:
   - Their clarity session
   - Their past patterns (from summaries)
   - Specific next steps

4. Update their user profile with:
   - Core values discovered
   - Identity shifts
   - Goals clarified

5. Determine if a goal should be created/updated

RETURN JSON:
{
  "summary": "Comprehensive summary of their clarity session",
  "insights": ["insight 1", "insight 2", "insight 3"],
  "clarity_map": {
    "goal": "Their stated goal",
    "future_vision": "What success looks like",
    "pain_points": ["pain 1", "pain 2"],
    "core_why": "The deepest why",
    "identity_statement": "I am someone who...",
    "primary_obstacle": "Main blocker",
    "success_criteria": "Measurable outcome",
    "milestones": ["milestone 1", "milestone 2", "milestone 3"],
    "this_week_commitment": "Specific action with timeline"
  },
  "updated_profile": {
    "short_term_state": "Current state summary",
    "long_term_patterns": ["pattern 1", "pattern 2"],
    "growth_areas": ["area 1"],
    "strengths": ["strength 1"],
    "core_values": ["value 1", "value 2"]
  },
  "should_create_goal": true/false,
  "suggested_goal": {
    "title": "Goal title",
    "description": "Based on clarity session",
    "why_it_matters": "From their core why",
    "category": "career|health|relationships|personal"
  } or null,
  "suggested_actions": ["action 1", "action 2", "action 3"]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { goal_text, stage_responses, full_content, past_summaries, user_profile } = req.body;

    if (!goal_text || !stage_responses) {
      return res.status(400).json({ error: 'goal_text and stage_responses required' });
    }

    // Format stage responses for AI
    const formattedResponses = stage_responses.map(r => ({
      stage: r.stage,
      question: r.question,
      answer: r.answer,
      depth_attempts: r.attempt
    }));

    const userMessage = {
      goal: goal_text,
      responses: formattedResponses,
      past_summaries: past_summaries || [],
      user_profile: user_profile || 'No profile yet.',
    };

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: CLARITY_ANALYSIS_PROMPT },
        { role: 'user', content: JSON.stringify(userMessage) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1500,
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    return res.status(200).json(analysis);
  } catch (error) {
    console.error('Error analyzing clarity session:', error);
    return res.status(500).json({ 
      error: 'Failed to analyze clarity session',
      details: error.message 
    });
  }
}