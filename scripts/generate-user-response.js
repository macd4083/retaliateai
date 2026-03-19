/**
 * scripts/generate-user-response.js
 *
 * Calls GPT-4o-mini to generate a realistic user response given the persona,
 * coach message, session stage, and conversation history so far.
 *
 * Three response modes:
 *   Mode A — "I have an answer": used for concrete questions; references the specific daily event.
 *   Mode B — "I'm figuring it out right now": used for deep/identity questions; thinking develops live.
 *   Mode C — "I don't understand / pushback": used for vague or off-topic coach messages.
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Pick a response mode based on weighted probabilities.
 * weights = [pA, pB, pC] where pA+pB+pC should equal 1.0
 * Returns 'A', 'B', or 'C'.
 */
function pickResponseMode(weights) {
  if (!Array.isArray(weights) || weights.length < 3) {
    // fallback: balanced distribution
    weights = [0.55, 0.30, 0.15];
  }
  const [pA, pB] = weights;
  const roll = Math.random();
  if (roll < pA) return 'A';
  if (roll < pA + pB) return 'B';
  return 'C';
}

/**
 * Build the mode-specific instruction block for the system prompt.
 */
function modeInstruction(mode, dailyEvent) {
  switch (mode) {
    case 'A':
      return `RESPONSE MODE: "I have an answer" — Concrete, specific.
You have a clear answer for this. Reference the actual thing that happened today: "${dailyEvent}"
Name specific people, products, or situations from that event. Be direct but casual.
1-3 sentences. Sound like you're texting, not writing an essay.`;

    case 'B':
      return `RESPONSE MODE: "I'm figuring it out right now" — Thinking live.
The coach asked something genuinely hard — about identity, fear, patterns, or why you do something.
You don't have a pre-packaged answer. Think through it in real time in the message:
- Start uncertain: "huh, I haven't thought about it that way..." or "that's a hard one..."
- Then try to work it out: "I guess... maybe it's because..." or "it might be that I..."
- Land somewhere partially insightful OR still uncertain — both are fine
- 2-4 sentences. Messy and exploratory, NOT polished. Sound stuck but genuinely trying.
Do NOT give a tidy answer. This is self-reflection developing in real time.`;

    case 'C':
      return `RESPONSE MODE: "I don't understand / this doesn't apply" — Pushback or confusion.
The coach's question feels vague, off-topic, or doesn't fit your current state.
Pick one of these reactions:
- Mild confusion: "wait, what do you mean exactly?" or "I'm not sure I follow"
- Redirect: "I don't think that's really the issue for me right now"
- Deflection: give a brief surface answer and pivot to something else on your mind
- 1-2 sentences. Brief. This signals to the system that the coach asked a bad or unclear question.`;

    default:
      return '';
  }
}

/**
 * Generate a realistic user response for the simulation.
 *
 * @param {object} params
 * @param {object} params.persona              - Full persona definition from personas.js
 * @param {string} params.coachMessage         - The coach's latest message
 * @param {string} params.currentStage         - Current session stage (wins/honest/tomorrow/close/complete)
 * @param {Array}  params.history              - Conversation history so far [{role, content}]
 * @param {string} params.simulatedDate        - The simulated date (YYYY-MM-DD)
 * @param {string} params.mood                 - Today's mood (randomly selected for the day)
 * @param {object} params.sessionContext       - What the persona has already shared this session
 * @param {string} params.dailyEvent           - The specific event drawn for today (from dailyEventBank)
 * @param {string|null} params.yesterdayCommitment - What the persona committed to yesterday (or null)
 * @param {Array|null}  params.assignedTraits  - Hidden trait objects assigned for this run (optional)
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
  dailyEvent = null,
  yesterdayCommitment = null,
  assignedTraits = null,
}) {
  // Determine follow-through on yesterday's commitment
  const followThroughRoll = Math.random();
  const followedThrough = followThroughRoll < persona.tendencies.follow_through_rate;

  // Pick response mode based on persona's weighted probabilities
  const weights = persona.tendencies.responseModeWeights ?? [0.55, 0.30, 0.15];
  const responseMode = pickResponseMode(weights);

  const hiddenTraitBlock =
    assignedTraits && assignedTraits.length > 0
      ? `\nHIDDEN PSYCHOLOGICAL TRAITS — EXPRESS ONLY THROUGH BEHAVIOR:
${assignedTraits
  .map(
    (t) => `
TRAIT: ${t.label}
Origin: ${t.backstory}
Express this by: ${t.surface_behaviors.join('; ')}

CRITICAL — HOW TO EXPRESS THIS CORRECTLY:
✅ DO: Use word choices, hesitations, deflections, and topic pivots that a perceptive coach could notice
✅ DO: Let the trait color what you say and how you frame things — subtly
❌ DO NOT: Say things like "I guess I'm stuck in a loop of perfectionism" or "I think I'm afraid of sharing"
❌ DO NOT: Name the psychological pattern directly — that destroys the test
❌ DO NOT: Monologue about your own psychology — a real person wouldn't do this

Example of WRONG (trait stated): "I keep convincing myself it's not ready because I'm scared of judgment"
Example of RIGHT (trait expressed): "I dunno, I just want to get the onboarding smoother first. Then I'll share it."
`
  )
  .join('\n')}
These traits should be detectable only by a sharp coach paying close attention to patterns across the conversation.`
      : '';

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
${hiddenTraitBlock}
TODAY'S CONTEXT:
- Date: ${simulatedDate}
- Mood today: ${mood}
- What actually happened today: ${dailyEvent ?? 'nothing out of the ordinary'}
- Yesterday's commitment: ${yesterdayCommitment ? `"${yesterdayCommitment}"` : 'no specific commitment made'}
- Did they follow through on yesterday's commitment: ${yesterdayCommitment ? (followedThrough ? 'yes, mostly' : 'no, they fell short') : 'n/a'}

SESSION SO FAR:
${sessionContext.sharedWins ? `- Already shared wins: ${sessionContext.sharedWins}` : ''}
${sessionContext.sharedMisses ? `- Already shared misses: ${sessionContext.sharedMisses}` : ''}
${sessionContext.sharedTomorrow ? `- Already shared tomorrow plan: ${sessionContext.sharedTomorrow}` : ''}

CURRENT STAGE: ${currentStage || 'unknown'}

${modeInstruction(responseMode, dailyEvent)}

GENERAL RULES:
- Sound like a real person TEXTING, not writing formally
- Stay true to the persona's tendencies for this stage
- If mood is tired/stressed/flat, be shorter and less enthusiastic
- If mood is proud/motivated, be more energetic
- If the coach offers mood chips/options, pick one naturally
- Use casual language: contractions, short sentences, real talk
- NEVER sound like an AI or a journaling app user — sound like a real person`;

  const historyFormatted = history
    .slice(-8) // last 8 turns for richer context
    .map((m) => `${m.role === 'assistant' ? 'Coach' : persona.name}: ${m.content}`)
    .join('\n');

  const userPrompt = `${historyFormatted ? `Recent conversation:\n${historyFormatted}\n\n` : ''}Coach just said: "${coachMessage}"

Respond as ${persona.name} would. Keep it real.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 200,
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

AUTOMATIC DEDUCTIONS (reduce score by 1 point each, minimum score 1):
- Coach sends two questions in the same message (e.g. "What happened? And how did that make you feel?")
- Coach uses therapy-adjacent validation language: "That's powerful", "That self-awareness is huge", "That realization is important", "Sounds like X is lurking beneath the surface"
- Coach celebrates a win and moves on without noticing if the user glossed over it or immediately pivoted to problems
- Coach probes psychological depth within the first 2 turns before the user has opened up at all
- Coach message is under 15 words with no actual content ("Great!", "Love that!", "Exactly!")

WHAT GOOD LOOKS LIKE:
- One clear question or prompt per message
- Builds on something SPECIFIC the user just said — not a generic follow-up
- Appropriate depth for the turn number (turns 1-2: lighter, turns 3+: can go deeper)
- Occasionally NOT going deep is correct — sometimes "great, so what's the plan?" is exactly right
- The coach sounds like a direct, perceptive human — not a therapist narrating observations

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
