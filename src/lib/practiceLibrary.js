/**
 * src/lib/practiceLibrary.js
 *
 * Single source of truth for all coaching practices.
 *
 * Each practice has:
 *   id                   — matches the exercise_run value in reflection-coach.js
 *   label                — display name
 *   category             — motivation | identity | accountability | clarity | resilience | gratitude
 *   trigger_signals      — emotional_state / intent values from the classifier that suggest this practice
 *   insight_types        — which user_insight pattern_type values make this practice relevant
 *   session_context      — which session stages this fits (wins | honest | close | any)
 *   requires_data        — profile fields this practice uses (will degrade gracefully if missing)
 *   cold_start_compatible — works on first session with no history
 *   description          — one sentence describing the practice
 *   coach_prompt         — exact instruction text for the AI (moved from reflection-coach.js)
 *   first_time_intro     — how to frame it when exercises_explained doesn't include this id yet
 *   estimated_turns      — typical number of back-and-forth turns
 */

export const PRACTICES = [
  {
    id: 'gratitude_anchor',
    label: 'Gratitude Anchor',
    category: 'gratitude',
    trigger_signals: ['low', 'frustrated'],
    insight_types: ['blocker', 'identity_theme'],
    session_context: ['wins', 'honest', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Finds one thing still working when energy or mood is low.',
    coach_prompt: `gratitude_anchor: "Name one thing from today that's still working, even if it's small." → Reflect back + connect to identity. Chips: ["Still has momentum 💪","Small but real ✅","Hard to find one 😔"]`,
    first_time_intro: `I want to try something — it's a quick reset to find what's still solid before we go deeper.`,
    estimated_turns: 2,
  },
  {
    id: 'why_reconnect',
    label: 'Why Reconnect',
    category: 'motivation',
    trigger_signals: ['vent', 'flat', 'motivated'],
    insight_types: ['blocker', 'identity_theme'],
    session_context: ['honest', 'any'],
    requires_data: ['why'],
    cold_start_compatible: false,
    description: "Tests whether the user's stated reason still feels true, then bridges to action.",
    coach_prompt: `why_reconnect: "You told me this matters because [actual why]. Does that still feel true?" → If yes: "So what's getting between you and that?" If no: "What changed?"`,
    first_time_intro: `I want to go back to your why — the reason you said this actually matters to you.`,
    estimated_turns: 3,
  },
  {
    id: 'evidence_audit',
    label: 'Evidence Audit',
    category: 'resilience',
    trigger_signals: ['anxious', 'self_doubt', 'stuck'],
    insight_types: ['blocker', 'identity_theme'],
    session_context: ['honest', 'any'],
    requires_data: [],
    cold_start_compatible: false,
    description: 'Counteracts self-doubt by surfacing concrete recent evidence of capability.',
    coach_prompt: `evidence_audit: "Name three things you've done in the last 30 days that the version of you who's failing wouldn't have done."`,
    first_time_intro: `When self-doubt shows up, the fastest way through it is evidence. Let's do a quick audit.`,
    estimated_turns: 3,
  },
  {
    id: 'implementation_intention',
    label: 'Implementation Intention',
    category: 'accountability',
    trigger_signals: ['stuck', 'flat', 'procrastination'],
    insight_types: ['blocker'],
    session_context: ['close', 'honest'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Converts vague plans into a specific when/what commitment.',
    coach_prompt: `implementation_intention: "Not what you want to do — when exactly, day and time, and what's the first 2-minute action." Push back if vague. Store as tomorrow_commitment. STOP once specific.`,
    first_time_intro: `Vague plans don't stick. Let's turn this into something specific — when and what exactly.`,
    estimated_turns: 2,
  },
  {
    id: 'values_clarification',
    label: 'Values Clarification',
    category: 'clarity',
    trigger_signals: ['stuck', 'reflective', 'off_topic'],
    insight_types: ['identity_theme', 'blocker'],
    session_context: ['honest', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Surfaces what actually matters by removing social pressure from the equation.',
    coach_prompt: `values_clarification: "If no one was watching and there were no consequences — what would you actually spend your time on?" → "What does that tell you about what actually matters?"`,
    first_time_intro: `I want to strip away what you think you should want for a second and ask a different question.`,
    estimated_turns: 3,
  },
  {
    id: 'future_self_bridge',
    label: 'Future Self Bridge',
    category: 'motivation',
    trigger_signals: ['reflective', 'stuck', 'low'],
    insight_types: ['identity_theme', 'blocker'],
    session_context: ['honest', 'close', 'any'],
    requires_data: ['future_self'],
    cold_start_compatible: false,
    description: 'Connects a current decision or struggle to their stated future self vision.',
    coach_prompt: `future_self_bridge: "You told me in a year you want to be [actual future_self]. What would that version of you say about tonight?" → "What's one decision right now that moves toward that?"`,
    first_time_intro: `Let me pull in the version of you from a year from now — the one you described.`,
    estimated_turns: 3,
  },
  {
    id: 'ownership_reframe',
    label: 'Ownership Reframe',
    category: 'accountability',
    trigger_signals: ['excuse', 'frustrated'],
    insight_types: ['blocker'],
    session_context: ['honest', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Redirects from external blame to the controllable part of any situation.',
    coach_prompt: `ownership_reframe: "What was the part that was in your control?" → If ownership: "That's the only part that matters. So what do you do with that?"`,
    first_time_intro: `I'm going to redirect for a second — not to dismiss what happened, but to find the lever.`,
    estimated_turns: 2,
  },
  {
    id: 'triage_one_thing',
    label: 'Triage One Thing',
    category: 'clarity',
    trigger_signals: ['overwhelmed'],
    insight_types: ['blocker'],
    session_context: ['wins', 'honest', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Cuts through overwhelm by forcing a single priority choice.',
    coach_prompt: `triage_one_thing: "Out of everything you're carrying — what's the ONE thing that actually matters most?" → "What's one move on that one thing?"`,
    first_time_intro: `When everything feels urgent, nothing actually is. Let's find the one thing.`,
    estimated_turns: 2,
  },
  {
    id: 'identity_reinforcement',
    label: 'Identity Reinforcement',
    category: 'identity',
    trigger_signals: ['celebrate', 'proud'],
    insight_types: ['strength', 'identity_theme'],
    session_context: ['wins', 'close'],
    requires_data: ['identity_statement'],
    cold_start_compatible: false,
    description: 'Anchors a real win to identity rather than letting it pass as luck.',
    coach_prompt: `identity_reinforcement: Fill in their ACTUAL win/action (never use placeholders). "That's a pattern, not a one-off. What does [their specific action] say about who you're becoming?" Then: "You told me you're someone who [their actual identity_statement]. Tonight proves it." Run ONCE per session only.`,
    first_time_intro: `What you just described is bigger than a win — let's actually name what it says about you.`,
    estimated_turns: 2,
  },
  {
    id: 'depth_probe',
    label: 'Depth Probe',
    category: 'clarity',
    trigger_signals: ['reflective', 'stuck', 'anxious'],
    insight_types: ['blocker', 'identity_theme', 'strength'],
    session_context: ['honest', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Surfaces the real pattern or belief behind a surface-level answer.',
    coach_prompt: `depth_probe (use naturally mid-conversation, not as a named exercise):
  Triggered when: user gives a surface answer to a meaningful question, or a pattern appears
  Examples: "Why do you think you keep coming back to that?" / "What's the story you're telling yourself about [X]?" / "What would have to be true about you for that to keep happening?"
  After a depth answer: sit with it. Reflect back what you heard. Then one forward question.`,
    first_time_intro: null,
    estimated_turns: 2,
  },
  {
    id: 'future_life_design',
    label: 'Future Life Design',
    category: 'motivation',
    trigger_signals: ['reflective', 'stuck', 'flat', 'off_topic'],
    insight_types: ['identity_theme', 'blocker'],
    session_context: ['honest', 'close', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Open-ended guided visioning — surfaces what the user actually wants their life to look like.',
    coach_prompt: `future_life_design: "When you think about what you want your life to actually look like — all the possibilities, no filters — what do you see? Take your time." → Let them describe freely. Reflect back specifics. Then: "Which part of that feels most real and most worth fighting for right now?"`,
    first_time_intro: `I want to put the day-to-day aside for a minute and ask a bigger question — what you actually want your life to look like.`,
    estimated_turns: 4,
  },
  {
    id: 'decision_alignment',
    label: 'Decision Alignment',
    category: 'identity',
    trigger_signals: ['stuck', 'reflective', 'flat'],
    insight_types: ['identity_theme', 'blocker'],
    session_context: ['honest', 'close', 'any'],
    requires_data: ['future_self'],
    cold_start_compatible: false,
    description: 'Converts abstract future-self identity into a real-time decision point.',
    coach_prompt: `decision_alignment: "You said your future self [actual future_self]. You're at a decision right now — [describe the choice they mentioned]. What would the future version of you choose?" → After they answer: "So what's stopping you from making that choice right now?"`,
    first_time_intro: `Let me hold your future self up against the decision you're describing — this is where identity becomes real.`,
    estimated_turns: 3,
  },
  {
    id: 'gratitude_specific',
    label: 'Specific Gratitude',
    category: 'gratitude',
    trigger_signals: ['flat', 'low', 'frustrated'],
    insight_types: ['blocker', 'identity_theme'],
    session_context: ['wins', 'honest', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Forces specificity to today — anchors present-moment appreciation with a concrete event.',
    coach_prompt: `gratitude_specific: "What happened today that, if it hadn't happened, today would have been worse?" → Don't accept vague answers. Push for one specific moment, interaction, or thing. Then: "Why does that one matter to you?" Connect to identity or values if they reveal something.`,
    first_time_intro: `Not general gratitude — I want something specific from today. Something that actually happened.`,
    estimated_turns: 3,
  },
  {
    id: 'identity_audit',
    label: 'Identity Audit',
    category: 'identity',
    trigger_signals: ['stuck', 'anxious', 'reflective'],
    insight_types: ['identity_theme', 'strength', 'blocker'],
    session_context: ['honest', 'any'],
    requires_data: [],
    cold_start_compatible: false,
    description: 'Evidence-based identity construction — who you are based on provable actions in the last 7 days.',
    coach_prompt: `identity_audit: "Who are you right now? Not who you're becoming — who are you, provably, based on your actions in the last 7 days?" → Let them answer. Then pick one specific action they mentioned: "That person — the one who did [that] — what do they believe about themselves?" Push toward a concrete identity statement grounded in evidence, not aspiration.`,
    first_time_intro: `I want to build your identity from the bottom up — from what you've actually done, not what you want to do.`,
    estimated_turns: 4,
  },
  {
    id: 'possibility_space',
    label: 'Possibility Space',
    category: 'motivation',
    trigger_signals: ['flat', 'stuck', 'low', 'reflective'],
    insight_types: ['identity_theme', 'blocker'],
    session_context: ['honest', 'close', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'Creates excitement about the future by having the user project forward with no hedging allowed.',
    coach_prompt: `possibility_space: "If the plan you have right now works perfectly — what does your life look like in 3 years? Don't hedge. Don't qualify. Tell me what it actually looks like." → Reflect specifics back warmly. Then: "Which part of that would make the current hard stuff worth it?"`,
    first_time_intro: `I want to know what you're actually building toward — not the safe version, the real one.`,
    estimated_turns: 4,
  },
  {
    id: 'self_affirmation_build',
    label: 'Self-Affirmation Build',
    category: 'identity',
    trigger_signals: ['anxious', 'stuck', 'flat', 'self_doubt'],
    insight_types: ['strength', 'identity_theme'],
    session_context: ['honest', 'close', 'any'],
    requires_data: [],
    cold_start_compatible: false,
    description: 'User-generated affirmations built from their own evidence — not canned language.',
    coach_prompt: `self_affirmation_build: "Based on what you've actually done — not what you want to do, not who you want to be — finish this sentence out loud: 'I am someone who...'" → Accept their answer, then push once: "Give me another one. Different domain, same level of honesty." End with: "Those aren't affirmations. Those are facts."`,
    first_time_intro: `I'm going to ask you to build an affirmation — but not the kind you read off a list. From evidence.`,
    estimated_turns: 3,
  },
  {
    id: 'next_chapter_write',
    label: 'Next Chapter Write',
    category: 'motivation',
    trigger_signals: ['reflective', 'motivated', 'flat'],
    insight_types: ['identity_theme'],
    session_context: ['close', 'any'],
    requires_data: [],
    cold_start_compatible: true,
    description: 'In-app journaling practice — user writes one paragraph about who they are 12 months from now, present tense.',
    coach_prompt: `next_chapter_write: "I want you to write one paragraph — not a list, a paragraph — about who you are 12 months from now. Present tense. 'I am...' not 'I will be...'. Write it like it's already true." → After they write it: "What part of that do you most want to be true?" Then: "What's the version of you right now that makes that possible?"`,
    first_time_intro: `This is a writing exercise — the kind of thing that makes the future feel real instead of theoretical.`,
    estimated_turns: 4,
  },
  {
    id: 'momentum_anchor',
    label: 'Momentum Anchor',
    category: 'resilience',
    trigger_signals: ['flat', 'low', 'stuck'],
    insight_types: ['strength', 'identity_theme'],
    session_context: ['wins', 'honest', 'any'],
    requires_data: [],
    cold_start_compatible: false,
    description: "Surfaces intrinsic drive evidence by finding the best thing the user almost didn't do.",
    coach_prompt: `momentum_anchor: "What's the best thing you've done in the last 30 days that you almost didn't do? The thing where you had every reason to skip it but you didn't." → Once they name it: "What made you do it anyway?" Sit with their answer. Then: "That thing — that force — is still in you. What would it say about this week?"`,
    first_time_intro: `I want to find your actual drive — not the goal, the thing that made you act when you could have quit.`,
    estimated_turns: 3,
  },
];

/** Look up a single practice by id. Returns undefined if not found. */
export function getPractice(id) {
  return PRACTICES.find((p) => p.id === id);
}

/**
 * Return practices that are relevant for a given set of user insight types.
 * @param {string[]} insightTypes  — e.g. ['blocker', 'identity_theme']
 * @param {string[]} excludeIds    — practice ids already run this session
 */
export function getPracticesForInsights(insightTypes, excludeIds = []) {
  return PRACTICES.filter(
    (p) =>
      !excludeIds.includes(p.id) &&
      p.insight_types.some((t) => insightTypes.includes(t))
  );
}

/**
 * Return practices matching a set of emotional/intent signals.
 * @param {string[]} signals   — emotional_state, intent values from classifier
 * @param {string[]} excludeIds
 */
export function getPracticesForSignals(signals, excludeIds = []) {
  return PRACTICES.filter(
    (p) =>
      !excludeIds.includes(p.id) &&
      p.trigger_signals.some((s) => signals.includes(s))
  );
}

/**
 * Return all cold-start compatible practices (usable on first session).
 */
export function getColdStartPractices(excludeIds = []) {
  return PRACTICES.filter((p) => p.cold_start_compatible && !excludeIds.includes(p.id));
}

export default PRACTICES;
