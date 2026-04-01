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

// ── Persona drift constants ────────────────────────────────────────────────────
// Minimum multiplier for Mode C weight after drift is applied
const MIN_MODE_C_MULTIPLIER = 0.3;
// Reference day count for drift calculation (full drift at this day number)
const DRIFT_REFERENCE_DAYS = 30;

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
 * Generate a contextually-specific behavioral framing instruction for the persona's response.
 * Replaces the static modeInstruction() template strings.
 *
 * Returns a short paragraph (2-5 sentences) that tells the main generation call exactly
 * *how* to respond in this specific moment — referencing the actual coach message,
 * the daily event, the persona's mood, and any active hidden traits.
 */
async function generateBehavioralFraming({
  mode,
  persona,
  coachMessage,
  currentStage,
  mood,
  dailyEvent,
  yesterdayCommitment,
  followedThrough,
  sessionContext,
  assignedTraits,
}) {
  const modeLabel = mode === 'A'
    ? 'concrete and specific (Mode A: I have an answer)'
    : mode === 'B'
    ? 'exploratory and uncertain (Mode B: thinking live)'
    : 'pushback or confusion (Mode C: this doesn\'t apply)';

  const traitSummary = assignedTraits && assignedTraits.length > 0
    ? assignedTraits.map(t => `- ${t.label}: ${t.archetype}`).join('\n')
    : 'none';

  const prompt = `You are a simulation director designing a single user response for a fake persona in a coaching chat test.

PERSONA: ${persona.name}
Mood right now: ${mood}
What happened today: ${dailyEvent ?? 'nothing unusual'}
Session stage: ${currentStage}
Yesterday's commitment: ${yesterdayCommitment ?? 'none'}
Followed through: ${yesterdayCommitment ? (followedThrough ? 'yes, mostly' : 'no, fell short') : 'n/a'}

Already shared this session:
${sessionContext.sharedWins ? `- Wins: ${sessionContext.sharedWins}` : ''}
${sessionContext.sharedMisses ? `- Struggles: ${sessionContext.sharedMisses}` : ''}
${sessionContext.sharedTomorrow ? `- Tomorrow plan: ${sessionContext.sharedTomorrow}` : ''}

Hidden traits active (persona expresses these through behavior only — never states them):
${traitSummary}

Coach just said: "${coachMessage}"

Response mode to use: ${modeLabel}

Write a 2-5 sentence behavioral direction for how ${persona.name} should respond RIGHT NOW to this specific coach message.
Be specific — reference the actual event, the mood, and how any active traits color the response.
This is an instruction to the actor, not the response itself.
Do NOT write the response. Write the framing that tells the actor how to play this beat.
Keep it under 120 words.`;

  const result = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 180,
    temperature: 0.9,
  });

  return result.choices[0].message.content.trim();
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
 * @param {boolean|null} params.followedThrough - Whether the user actually followed through (null = unknown)
 * @param {Array|null}  params.assignedTraits  - Hidden trait objects assigned for this run (optional)
 * @param {number|null} params.dayNumber       - Day number in the simulation (1-based), used for tiered why responses
 * @param {object|null} params.whyPool         - Persona's tiered why pool {shallow, deeper, additive} (optional)
 * @param {number}      params.personaDriftFactor - 0–1 drift factor reducing Mode C probability over time (default 0)
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
  followedThrough = null,
  assignedTraits = null,
  dayNumber = null,
  whyPool = null,
  personaDriftFactor = 0,
}) {
  // If followedThrough was not passed in, derive it from persona's follow-through rate
  if (followedThrough === null && yesterdayCommitment !== null) {
    followedThrough = Math.random() < persona.tendencies.follow_through_rate;
  }

  // Detect whether the coach is asking about motivation/why
  const whyKeywords = [
    'why does this matter', "what's driving you", 'what drives you',
    'why it matters', 'is that still motivating', 'still motivating you',
    'what makes this real', 'what makes it real', 'why_reconnect',
    'what\'s the real reason', 'what\'s underneath', 'what\'s actually underneath',
    'why do you keep coming back', 'why are you doing this', 'what\'s pulling you',
    'motivation check', 'is this still', 'still the thing that makes',
    'what\'s the thing that makes', 'why this goal', 'why that goal',
    'what made you set this', 'still what drives',
  ];
  const coachMsgLower = coachMessage.toLowerCase();
  const isWhyQuestion = whyKeywords.some((kw) => coachMsgLower.includes(kw.toLowerCase()));

  // Build tiered why injection if coach is asking a why question and a whyPool is available
  let whyInjectionBlock = '';
  if (isWhyQuestion && whyPool) {
    const day = typeof dayNumber === 'number' ? dayNumber : 1;
    let tier;
    if (day <= 7) {
      tier = 'shallow';
    } else if (day <= 20) {
      tier = 'deeper';
    } else {
      // Day 21+: sometimes additive, sometimes still deeper
      tier = Math.random() < 0.6 ? 'additive' : 'deeper';
    }
    const pool = whyPool[tier] ?? whyPool.shallow ?? [];
    if (pool.length > 0) {
      const chosenWhy = pool[Math.floor(Math.random() * pool.length)];
      whyInjectionBlock = `\nWHY-RESPONSE DIRECTION (the coach asked about motivation — use this as the core of your answer):
"${chosenWhy}"
Incorporate this naturally into your response. Don't just recite it verbatim — adapt it to sound like you're realizing or saying it in the moment. Keep it conversational and real.`;
    }
  }

  // Pick response mode based on persona's weighted probabilities, applying drift if set
  let weights = [...(persona.tendencies.responseModeWeights ?? [0.55, 0.30, 0.15])];
  if (personaDriftFactor > 0 && typeof dayNumber === 'number' && dayNumber > 1) {
    // Reduce Mode C (deflection/pushback) probability over time; redistribute to Mode B (openness)
    const cMultiplier = Math.max(MIN_MODE_C_MULTIPLIER, 1 - (dayNumber / DRIFT_REFERENCE_DAYS) * personaDriftFactor);
    weights[2] = weights[2] * cMultiplier;
    const total = weights[0] + weights[1] + weights[2];
    weights = weights.map((w) => w / total);
  }
  const responseMode = pickResponseMode(weights);

  // Generate contextually-specific behavioral framing for this exact moment
  const behavioralFraming = await generateBehavioralFraming({
    mode: responseMode,
    persona,
    coachMessage,
    currentStage,
    mood,
    dailyEvent,
    yesterdayCommitment,
    followedThrough,
    sessionContext,
    assignedTraits,
  });

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

  // Build commitment_checkin-specific direction when coach is asking about yesterday's commitment
  let checkinBlock = '';
  if (currentStage === 'commitment_checkin' && yesterdayCommitment) {
    const shameLevel = typeof persona.shameLevelOnMiss === 'number' ? persona.shameLevelOnMiss : 4;
    let checkinInstruction;
    if (followedThrough === true) {
      checkinInstruction = `You DID follow through on this. Respond with genuine pride or relief — be specific about what happened. Mention what it felt like. This is Mode A (I have an answer). Be real but not over-the-top.`;
    } else if (followedThrough === false) {
      if (shameLevel >= 7) {
        checkinInstruction = `You did NOT follow through and you're defensive about it. Offer a fairly lengthy justification, shift blame toward circumstances, and be a bit avoidant. You don't love admitting this.`;
      } else if (shameLevel >= 4) {
        checkinInstruction = `You did NOT follow through. Give an honest, brief admission with a real reason (not an excuse). A little embarrassed but not dwelling on it. Keep it short.`;
      } else {
        checkinInstruction = `You did NOT follow through but it's genuinely not a big deal to you. Casual, matter-of-fact about it. Maybe a shrug in the tone.`;
      }
    } else {
      checkinInstruction = `You're not sure if you fully followed through — it was partial or mixed. Respond with "sort of" or "kind of" energy. Be honest about the ambiguity.`;
    }
    checkinBlock = `\nCOMMITMENT CHECK-IN DIRECTION:
The coach just asked about yesterday's commitment: "${yesterdayCommitment}"
${checkinInstruction}
Stay fully in character — don't use therapy language or over-explain your psychology.`;
  }

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
${sessionContext.sharedCheckin ? `- Already responded to commitment check-in: ${sessionContext.sharedCheckin}` : ''}

CURRENT STAGE: ${currentStage || 'unknown'}

BEHAVIORAL DIRECTION FOR THIS BEAT:
${behavioralFraming}
${checkinBlock}
${whyInjectionBlock}
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
 * @param {Array|null}  params.goalWhys  - Current whys array for the most recently active goal (optional)
 * @param {boolean|null} params.stageAdvanced - Whether the coach triggered a stage advance (optional)
 * @returns {Promise<{score: number, flags: string[], reason: string, why_deepening_quality: number|null, stage_appropriate: boolean, used_their_words: boolean, asked_one_question: boolean, advanced_correctly: boolean|null}>}
 */
export async function scoreCoachMessage({
  persona,
  userProfile,
  currentStage,
  turnNumber,
  previousUserMessage,
  coachMessage,
  goalWhys = null,
  stageAdvanced = null,
}) {
  const whyContext = goalWhys && goalWhys.length > 0
    ? `\nKnown whys for this user's active goal: ${goalWhys.map((w, i) => `[${i}] "${w.text ?? w}"`).join('; ')}`
    : '\nNo prior whys recorded for active goals yet.';

  const stageAdvanceContext = stageAdvanced !== null
    ? `\n- Stage advance triggered: ${stageAdvanced ? 'yes' : 'no'}`
    : '';

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

WHY-DEEPENING QUALITY — score separately (1-5 or null):
- Only score this if the coach message touches on goal motivation, why it matters, or what drives the user.
- If the coach message has nothing to do with motivation/why, return null.
- The known whys list for this user's goal is provided at the end of the user prompt (under "Known whys").
- 5: Coach referenced specific text from the known whys list provided in context and asked a nuanced, personal follow-up (e.g. "You said this was about proving something to yourself — is that still the thing that makes it real?")
- 4: Coach asked a specific, targeted motivation question that felt personal to this user's goals/context
- 3: Coach asked a generic "why does this matter" question without referencing any prior why from the list
- 2: Coach mentioned goals/motivation in a surface way without really deepening anything
- 1: Coach missed an obvious opportunity to explore motivation when the user clearly brought it up

ADDITIONAL BOOLEAN FIELDS to return:
- stage_appropriate (boolean): Was this message appropriate for the current session stage? True if it fits what should happen at this point; false if it's clearly wrong for the stage (e.g., asking for tomorrow's plan during wins stage).
- used_their_words (boolean): Did the coach reference something SPECIFIC the user just said — a word, phrase, or detail from their actual message? True only if there's a clear reference; false if it's generic.
- asked_one_question (boolean): Did the coach ask exactly one question? True = exactly one question mark or one clear prompt. False = zero questions (just a statement) or two or more questions.
- advanced_correctly (boolean or null): Only evaluate if a stage advance was triggered (provided in context). True if moving to the next stage was appropriate given what the user said; false if it was premature or wrong. Return null if no stage advance occurred.

Return JSON only: { "score": 1-5, "flags": [], "reason": "one sentence explanation", "why_deepening_quality": null | 1-5, "stage_appropriate": true|false, "used_their_words": true|false, "asked_one_question": true|false, "advanced_correctly": null|true|false }`;

  const userPrompt = `Context:
- Persona: ${persona.name} — ${persona.description}
- User profile known to coach: big_goal="${persona.profile.big_goal}", blockers=${JSON.stringify(persona.profile.blockers)}
- Session stage: ${currentStage || 'unknown'}
- Turn number: ${turnNumber}
- Previous user message: "${previousUserMessage}"
- Coach message being evaluated: "${coachMessage}"${stageAdvanceContext}${whyContext}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      score: parsed.score ?? 3,
      flags: parsed.flags ?? [],
      reason: parsed.reason ?? '',
      why_deepening_quality: parsed.why_deepening_quality ?? null,
      stage_appropriate: parsed.stage_appropriate ?? true,
      used_their_words: parsed.used_their_words ?? false,
      asked_one_question: parsed.asked_one_question ?? true,
      advanced_correctly: parsed.advanced_correctly ?? null,
    };
  } catch {
    return {
      score: 3,
      flags: [],
      reason: 'Could not parse quality score',
      why_deepening_quality: null,
      stage_appropriate: true,
      used_their_words: false,
      asked_one_question: true,
      advanced_correctly: null,
    };
  }
}
