/**
 * src/lib/classifier.js
 *
 * Shared intent classifier — single source of truth used by both
 * api/reflection-coach.js and api/classify-intent.js.
 *
 * Uses gpt-4o-mini with low max_tokens (~300–600 ms).
 *
 * Returns a JSON object:
 *   intent, energy_level, accountability_signal, emotional_state,
 *   depth_opportunity, checklist_content, suggested_exercise,
 *   energy_type, depth_opportunity_count
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const CLASSIFIER_SYSTEM = `You are a message intent classifier for a nightly reflection coaching app.
Return ONLY valid JSON:
{
  "intent": "<checkin|vent|question|advice_request|memory_query|stuck|celebrate|off_topic>",
  "energy_level": "<low|medium|high>",
  "accountability_signal": "<excuse|ownership|neutral>",
  "emotional_state": "<frustrated|proud|anxious|flat|motivated|overwhelmed|reflective>",
  "depth_opportunity": <true|false>,
  "checklist_content": {"wins": false, "honest": false, "plan": false, "identity": false},
  "suggested_exercise": "<none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement|depth_probe>",
  "energy_type": "<momentum|depth|reflective|planning|identity>",
  "depth_opportunity_count": <0-3>
}

ACCOUNTABILITY SIGNAL RULES:
- excuse: The user actively deflects personal responsibility — e.g. "I couldn't because X happened", passive voice about their own failures where they had agency, or framing external events as the sole cause.
  DO NOT mark as excuse: simply mentioning that something hard happened today, naming a real external obstacle while still owning the miss, or factual context.
- ownership: "I did/didn't do X", taking personal responsibility, "I chose", "that was on me", "I let it slip"
- neutral: factual statement, question, context without clear responsibility signal, or ambiguous phrasing

KEY DISTINCTION — context vs. deflection:
  "my laptop broke so I couldn't work" → excuse (had alternatives, chose not to act)
  "got pulled into a 3-hour client emergency, still didn't finish the email" → neutral/ownership (real constraint named, no blame deflection)
  "I just didn't do it" → ownership
  "it was a crazy day" with no attempt to own anything → excuse
  When in doubt, lean toward neutral — only mark excuse when deflection is explicit and unambiguous.

EXERCISE ROUTING (pick the BEST match; default to "none"):
- excuse signal detected                         → ownership_reframe
- low energy AND frustrated emotional state      → gratitude_anchor
- intent is stuck OR message is "don't know what I want" type → values_clarification
- vent about motivation / motivation block       → why_reconnect
- self-doubt, imposter syndrome feelings         → evidence_audit
- procrastination mentioned or implied           → implementation_intention
- intent is celebrate OR emotional_state is proud → identity_reinforcement
- overwhelmed emotional state                    → triage_one_thing
- reflective / philosophical tone                → future_self_bridge
- surface answer to meaningful topic             → depth_probe
- intent is memory_query                         → none
- checkin with no notable signals                → none

ENERGY TYPE ROUTING:
- intent is celebrate OR emotional_state is proud            → momentum
- emotional_state is reflective OR intent is stuck OR emotional_state is anxious → depth or reflective
- emotional_state is flat OR energy_level is low             → reflective
- emotional_state is motivated                               → momentum or planning
- emotional_state is overwhelmed                             → planning

CHECKLIST CONTENT RULES:
- wins: message contains a win, success, accomplishment, something that went well
- honest: message contains an honest admission, something that went wrong, a miss, a struggle
- plan: message contains a commitment, plan for tomorrow, implementation intention
- identity: message references who they are, who they're becoming, values, identity statement

depth_opportunity=true when: user gives a surface-level or deflecting answer to something meaningful, or reveals a belief/pattern worth exploring.

IMPORTANT: If tomorrow_commitment is already filled, do NOT suggest implementation_intention. If exercise is in exercises_run, return "none".

No markdown. No explanation.`;

export const DEFAULT_CLASSIFICATION = {
  intent: 'checkin',
  energy_level: 'medium',
  accountability_signal: 'neutral',
  emotional_state: 'flat',
  depth_opportunity: false,
  checklist_content: { wins: false, honest: false, plan: false, identity: false },
  suggested_exercise: 'none',
  energy_type: 'momentum',
  depth_opportunity_count: 0,
};

/**
 * Classify a user message.
 *
 * @param {string} userMessage
 * @param {object} sessionContext  - { current_stage, tomorrow_commitment, exercises_run, depth_opportunity_count_so_far }
 * @returns {Promise<object>}
 */
export async function classifyIntent(userMessage, sessionContext = {}) {
  const { depth_opportunity_count_so_far = 0 } = sessionContext;
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        {
          role: 'user',
          content: `[Stage: ${sessionContext.current_stage || 'wins'}]\n[tomorrow_commitment: ${sessionContext.tomorrow_commitment || 'none'}]\n[exercises_run: ${(sessionContext.exercises_run || []).join(', ') || 'none'}]\n[depth_opportunity_count_so_far: ${depth_opportunity_count_so_far}]\n\n${userMessage}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 180,
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (_e) {
    return { ...DEFAULT_CLASSIFICATION };
  }
}
