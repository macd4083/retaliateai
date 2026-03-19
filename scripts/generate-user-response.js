/**
 * scripts/generate-user-response.js
 *
 * Calls GPT-4o-mini to generate a realistic user response given the persona,
 * coach message, session stage, and conversation history so far.
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate a realistic user response for the simulation.
 *
 * @param {object} params
 * @param {object} params.persona       - Full persona definition from personas.js
 * @param {string} params.coachMessage  - The coach's latest message
 * @param {string} params.currentStage  - Current session stage (wins/honest/tomorrow/close/complete)
 * @param {Array}  params.history       - Conversation history so far [{role, content}]
 * @param {string} params.simulatedDate - The simulated date (YYYY-MM-DD)
 * @param {string} params.mood          - Today's mood (randomly selected for the day)
 * @param {object} params.sessionContext - What the persona has already shared this session
 * @returns {Promise<string>} - The generated user message
 */
export async function generateUserResponse({
  persona,
  coachMessage,
  currentStage,
  history,
  simulatedDate,
  mood,
  sessionContext = {},
}) {
  const followThroughRoll = Math.random();
  const followedThrough = followThroughRoll < persona.tendencies.follow_through_rate;

  const systemPrompt = `You are roleplaying as ${persona.name}, a real person journaling with an AI reflection coach.

PERSONA:
${persona.description}

THEIR GOALS & CONTEXT:
- Big goal: ${persona.profile.big_goal}
- Why: ${persona.profile.why}
- Future self: ${persona.profile.future_self}
- Identity: ${persona.profile.identity_statement}
- Main blockers: ${persona.profile.blockers.join(', ')}

TENDENCIES:
- Wins stage: ${persona.tendencies.wins}
- Honest stage: ${persona.tendencies.honest}
- Tomorrow stage: ${persona.tendencies.tomorrow}
- Follow-through rate: ${persona.tendencies.follow_through_rate * 100}%

TODAY'S CONTEXT:
- Date: ${simulatedDate}
- Mood today: ${mood}
- Did they follow through on yesterday's commitment: ${followedThrough ? 'yes, mostly' : 'no, they fell short'}

SESSION SO FAR:
${sessionContext.sharedWins ? `- Already shared wins: ${sessionContext.sharedWins}` : ''}
${sessionContext.sharedMisses ? `- Already shared misses: ${sessionContext.sharedMisses}` : ''}
${sessionContext.sharedTomorrow ? `- Already shared tomorrow plan: ${sessionContext.sharedTomorrow}` : ''}

CURRENT STAGE: ${currentStage || 'unknown'}

RULES FOR YOUR RESPONSE:
- Sound like a real person TEXTING, not writing formally
- Keep it SHORT: 1-4 sentences typically. Never write paragraphs
- Stay true to the persona's tendencies for this stage
- If mood is tired/stressed, be shorter and less enthusiastic
- If mood is proud/motivated, be more energetic
- Occasionally be vague or surface-level (this tests whether the coach pushes deeper)
- If the coach offers mood chips/options, pick one naturally
- If asked a direct question, answer it (but maybe not fully if persona tendency is to deflect)
- Use casual language: contractions, short sentences, real talk
- NEVER sound like an AI or a journaling app user — sound like a real person`;

  const historyFormatted = history
    .slice(-6) // last 6 turns for context
    .map((m) => `${m.role === 'assistant' ? 'Coach' : persona.name}: ${m.content}`)
    .join('\n');

  const userPrompt = `${historyFormatted ? `Recent conversation:\n${historyFormatted}\n\n` : ''}Coach just said: "${coachMessage}"

Respond as ${persona.name} would. Keep it short and real.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 150,
    temperature: 0.85,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Score the quality of a coach message using GPT-4o-mini.
 *
 * @param {object} params
 * @param {object} params.persona        - Persona definition
 * @param {object} params.userProfile    - Known user profile fields
 * @param {string} params.currentStage   - Current session stage
 * @param {number} params.turnNumber     - Turn number in session
 * @param {string} params.previousUserMessage - What the user said before
 * @param {string} params.coachMessage   - The coach message to evaluate
 * @returns {Promise<{score: number, flags: string[], reason: string}>}
 */
export async function scoreCoachMessage({
  persona,
  userProfile,
  currentStage,
  turnNumber,
  previousUserMessage,
  coachMessage,
}) {
  const systemPrompt = `You are evaluating the quality of a reflection coach message. Score it 1-5 and flag issues.

Score meanings:
5 = Excellent — specific to this user, makes them think, advances the session naturally
4 = Good — relevant and appropriate, minor room for improvement
3 = Okay — generic or slightly off but not harmful
2 = Poor — generic template language, doesn't use user's context, or breaks coaching rules
1 = Bad — violates coaching rules (therapist language, two questions, validated excuse, etc.)

Flags (pick all that apply):
- GENERIC: doesn't use user's actual words, goals, or context
- TOO_LONG: more than 3 sentences
- SCATTERED_QUESTIONS: Asked two or more questions pulling the user in different directions, diluting focus. Do NOT flag when questions stack on the same topic to push deeper; only flag when they are genuinely unrelated or let the user dodge one by answering the other.
- THERAPIST_LANGUAGE: "how does that make you feel", overly clinical
- VALIDATED_EXCUSE: let the user off the hook instead of pivoting
- REPEATED_TOPIC: re-asked something already answered
- WEAK_DEPTH: missed a clear opportunity to go deeper
- OFF_STAGE: wrong stage for current conversation phase

Return JSON only: { "score": 1-5, "flags": [], "reason": "one sentence explanation" }`;

  const userPrompt = `Context:
- Persona: ${persona.name} — ${persona.description}
- User profile known to coach: big_goal="${persona.profile.big_goal}", blockers=${JSON.stringify(persona.profile.blockers)}
- Session stage: ${currentStage || 'unknown'}
- Turn number: ${turnNumber}
- Previous user message: "${previousUserMessage}"
- Coach message being evaluated: "${coachMessage}"`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 200,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      score: parsed.score ?? 3,
      flags: parsed.flags ?? [],
      reason: parsed.reason ?? '',
    };
  } catch {
    return { score: 3, flags: [], reason: 'Could not parse quality score' };
  }
}
