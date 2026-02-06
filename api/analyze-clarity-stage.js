import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stage-specific analysis prompts
const STAGE_PROMPTS = {
  vision: `Analyze if this answer shows SPECIFIC, VIVID vision or if it's VAGUE.

✅ DEEP: Specific details, sensory descriptions, emotional language, concrete examples
❌ SHALLOW: Vague ("I'd be happy"), list-based without feeling, no specifics

If SHALLOW, generate a follow-up that asks for sensory/emotional details or describes a specific moment.`,

  pain: `Analyze if this answer shows HONEST, VISCERAL pain or if it's DEFLECTING.

✅ DEEP: Honest about suffering, specific consequences, emotional weight, awareness of impact
❌ SHALLOW: Vague ("I'll be unhappy"), deflecting, minimizing, no emotion

If SHALLOW, call out the deflection gently and ask about day-to-day experience or how it FEELS.`,

  why: `Analyze if they've reached the EMOTIONAL ROOT or if they're still SURFACE-LEVEL.

✅ DEEP: Progression to vulnerability, identity-level, connection to values, emotional root
❌ SHALLOW: Same answer repeated, "should" language, practical reasons only

If SHALLOW after 3 attempts, ask: "What's the feeling underneath?" or "What would this heal in you?"`,

  identity: `Analyze if they described CHARACTER/VALUES or just ACHIEVEMENTS.

✅ DEEP: Character traits, values, how they show up, internal standards
❌ SHALLOW: Job titles, external markers, what they HAVE, vague

If SHALLOW, strip away achievements and ask about values or daily behavior.`,

  obstacles: `Analyze if they named a REAL OBSTACLE or gave an EXCUSE.

✅ DEEP: Specific blocker, personal responsibility, hidden obstacle revealed, awareness of pattern
❌ SHALLOW: Vague ("I'm lazy"), victim language, deflection, surface obstacle

If SHALLOW, dig deeper: "Is that the real issue, or is something underneath it?"`,

  roadmap: `Analyze if this is MEASURABLE or VAGUE.

✅ DEEP: Specific metrics, clear finish line, timeline, third-party verifiable
❌ SHALLOW: Feeling-based only, no numbers, no timeline, not measurable

If VAGUE, help them create specificity with numbers, dates, and observable outcomes.`,

  commitment: `Analyze if this is a REAL COMMITMENT or WISHFUL THINKING.

✅ DEEP: Specific action, time commitment, measurable, realistic
❌ SHALLOW: Vague ("I'll try"), no time, unrealistic, no specifics

If SHALLOW, ask for specific day/time and check if it's too big given their obstacles.`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      user_id,
      goal_text,
      stage,
      question,
      user_answer,
      attempt,
      previous_stages,
    } = req.body;

    // Get stage-specific prompt
    const stageGuidance = STAGE_PROMPTS[stage] || STAGE_PROMPTS.vision;

    const systemPrompt = `You are analyzing a user's response to a coaching question.

${stageGuidance}

Return JSON:
{
  "is_deep": true/false,
  "depth_score": 0-100,
  "reasoning": "Why this is deep or shallow",
  "follow_up_question": "Follow-up question to go deeper (if needed)" or null,
  "extracted_data": {} (any structured data you can extract)
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({
          goal: goal_text,
          question,
          answer: user_answer,
          attempt,
        }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 400,
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    return res.status(200).json({
      is_deep: analysis.depth_score >= 70,
      depth_score: analysis.depth_score,
      reasoning: analysis.reasoning,
      follow_up_question: analysis.follow_up_question,
      should_advance: analysis.depth_score >= 70 || attempt >= 3,
      extracted_data: analysis.extracted_data || {},
    });

  } catch (error) {
    console.error('Error analyzing stage:', error);
    return res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
}