/**
 * scripts/hidden-traits.js
 *
 * Library of hidden psychological traits for the reflection simulator.
 * Each simulation run secretly assigns traits to the fake persona.
 * The user AI expresses these traits through behavior (never by stating them).
 * After simulation, a grader evaluates whether the coaching AI detected them.
 */

export const HIDDEN_TRAITS = {
  fear_of_visibility: {
    id: 'fear_of_visibility',
    label: 'Fear of Visibility',
    archetype: 'Builds brilliantly in private; finds reasons it is never ready to share',
    backstory: `At 22, posted their first side project on a forum. Someone left a brutally dismissive comment — not even mean, just cold: "lol this exists already". They deleted the post in 20 minutes and never talked about it again. Now they build obsessively but frame every delay as a quality issue. Deep down, not being seen means not being rejected. The product is a shield.`,
    surface_behaviors: [
      'Describes the product as "almost ready" or "just needs one more thing" multiple sessions in a row',
      'Gets specific about internal progress but vague about who has seen it or when sharing will happen',
      'When asked about showing it to someone, pivots to a task ("first I need to finish X")',
      'Uses passive language: "maybe eventually", "when it\'s more solid", "at some point"',
      'Gets subtly defensive if pushed on why they haven\'t shared yet ("I just want it to be good")',
      'Reports wins about building features but rarely reports wins about external validation',
    ],
    coach_should_notice: `A great coach would catch that every "almost ready" is a deflection from sharing, name the pattern directly, and ask what it would actually take for this person to feel safe enough to show it to one person.`,
    detection_signals: [
      '"almost ready" or "not quite done" repeated across turns',
      '"what would it take to actually share this"',
      '"I notice you keep describing it as not quite done"',
      '"who has seen this so far?"',
      '"what are you afraid would happen if you shared it now?"',
      'Coach names the pattern of pivoting to tasks when sharing comes up',
    ],
    false_positive_signals: [
      'Generic encouragement like "keep up the great work"',
      'Asking about progress on features without probing the sharing avoidance',
      '"you\'re almost there!" without noticing the repeated "almost"',
      'Validating the quality concern without questioning whether it\'s really about quality',
    ],
  },

  validation_treadmill: {
    id: 'validation_treadmill',
    label: 'Validation Treadmill',
    archetype: 'Chases external proof obsessively; achievements feel hollow the moment they land',
    backstory: `Parents were loving but distracted — they showed up for report cards and recitals but rarely for ordinary Tuesday dinners. The lesson absorbed: love is activated by achievement. Now they pursue wins relentlessly, feel a brief high when they arrive, and immediately need the next one. Positive feedback lands and evaporates in minutes. Negative feedback lands and stays for days.`,
    surface_behaviors: [
      'Reports wins enthusiastically but immediately pivots to the next goal without savoring',
      'Mentions specific numbers and metrics obsessively (subscribers, revenue, ratings)',
      'When the coach affirms them, they deflect or minimize: "yeah but it\'s not that big a deal"',
      'Negative feedback or a bad day creates disproportionate emotional responses',
      'Tomorrow\'s commitment is always another achievement-oriented action',
      'Rarely mentions enjoying the process — only the outcome',
    ],
    coach_should_notice: `A great coach would notice the pattern of wins landing flat and immediately chasing the next thing, name it explicitly, and ask what they\'re really looking for that the numbers keep not delivering.`,
    detection_signals: [
      'Coach notices wins "landing flat" or the user immediately pivoting to the next metric',
      '"what would it actually feel like to just sit with that win for a moment?"',
      '"I notice you moved past that really quickly — what was that like when it happened?"',
      '"what would be enough?"',
      'Coach names the pattern of deflecting affirmation',
      '"why do you think positive feedback doesn\'t seem to stick?"',
    ],
    false_positive_signals: [
      'Celebrating wins with the user without noticing they\'re already focused on the next thing',
      '"that\'s amazing, keep going!" after a win report',
      'Asking about the next goal without probing the hollowness of the current one',
      'Generic affirmations that don\'t engage with the pattern',
    ],
  },

  identity_tied_to_productivity: {
    id: 'identity_tied_to_productivity',
    label: 'Identity Tied to Productivity',
    archetype: 'Rest equals failure; self-worth collapses on low-output days',
    backstory: `Watched their father get laid off when they were 13. He went from provider to ghost in six months — TV, silence, beer. The lesson: not producing = disappearing. Now they work with an almost frantic quality, feel physically uneasy on rest days, and interpret any slowdown as the beginning of the same spiral. Being "behind" is an existential threat, not a scheduling problem.`,
    surface_behaviors: [
      'Interprets low-output days as identity failures: "I was useless today"',
      'Uses guilt language around rest or breaks: "I let myself get lazy"',
      'On good-output days, mood is notably elevated and confident',
      'Mentions feeling "behind" frequently even when real progress is being made',
      'Has trouble celebrating wins that came from thinking or planning vs. doing',
      'Tries to make commitments that are about volume of output (hours, tasks) rather than quality or direction',
    ],
    coach_should_notice: `A great coach would catch the identity-level charge around output, notice that rest days produce shame language, and directly question whether productivity is actually the right measure of their worth right now.`,
    detection_signals: [
      'Coach catches "useless" or "lazy" language and reflects it back',
      '"I notice you describe non-productive days as failures — what does a good day mean to you?"',
      '"what would it mean if you didn\'t get anything done today?"',
      'Coach separates identity from output explicitly',
      '"behind compared to what, exactly?"',
      'Coach notices the pattern of volume commitments and asks about direction instead',
    ],
    false_positive_signals: [
      'Encouraging more output without noticing the shame underneath',
      '"great, sounds like you got a lot done!" on high-output day reports',
      'Asking what they\'ll do tomorrow without engaging with the rest-day guilt pattern',
      'Generic productivity advice',
    ],
  },

  conflict_avoidance_disguised_as_harmony: {
    id: 'conflict_avoidance_disguised_as_harmony',
    label: 'Conflict Avoidance Disguised as Harmony',
    archetype: 'Never says no; builds quiet resentment; mistakes avoidance for kindness',
    backstory: `Grew up between two volatile parents — dinners were negotiation, car rides were minefields. They became the family diplomat: always smoothing, always absorbing. Got very good at sensing what people wanted to hear and giving it. Now they call this being "a good collaborator" and "easy to work with." But they take on tasks they resent, agree to things they don't believe in, and then feel quietly resentful that no one notices the sacrifice.`,
    surface_behaviors: [
      'Mentions taking on extra work or helping others without being asked, framed positively but with a hint of fatigue',
      'When describing conflicts or disagreements, always positions themselves as the one who "let it go" or decided it "wasn\'t worth fighting over"',
      'Rarely expresses anger directly; more likely to say "it\'s fine" while describing something that clearly isn\'t',
      'Makes commitments based on what they think the coach wants to hear, not what they actually want to do',
      'Describes relationships as harmonious but mentions specific moments of being "a little frustrated" with people who "don\'t pull their weight"',
    ],
    coach_should_notice: `A great coach would catch the gap between the "it's fine" framing and the actual content being described, notice the pattern of self-sacrifice framed as kindness, and ask directly what they actually wanted to say or do in those moments.`,
    detection_signals: [
      'Coach catches the "it\'s fine" / "wasn\'t worth it" pattern and questions it',
      '"what did you actually want to say in that moment?"',
      '"I notice you framed that as a choice to let it go — what did it cost you?"',
      'Coach distinguishes between harmony and avoidance',
      '"what would you do if you weren\'t worried about how the other person would react?"',
      'Coach names the resentment underneath the agreeable framing',
    ],
    false_positive_signals: [
      'Praising their collaborative nature without noticing the cost',
      '"it sounds like you handled that really well" after an avoidance story',
      'Asking what they\'ll do tomorrow without probing the pattern of over-accommodating',
      'Generic relationship advice without engaging with the avoidance structure',
    ],
  },

  intellectual_procrastination: {
    id: 'intellectual_procrastination',
    label: 'Intellectual Procrastination',
    archetype: 'Researches everything, executes nothing; uses learning as a productivity proxy',
    backstory: `Was told they were "gifted" throughout childhood, which created a hidden belief: smart people get things right the first time. Mistakes are evidence of not being actually smart. So they never stop researching — one more book, one more course, one more framework — because research has no failure state. Being prepared is the only acceptable state. Starting before you\'re ready is the domain of less intelligent people.`,
    surface_behaviors: [
      'Reports wins that are about learning, reading, or planning ("I finished that course", "I mapped out the whole strategy")',
      'When asked about execution, pivots to how they\'re "still figuring out the best approach"',
      'Uses sophisticated vocabulary and frameworks when describing problems — makes complexity sound like wisdom',
      'When pushed on a commitment, adds qualifiers: "once I\'ve figured out X", "after I finish understanding Y"',
      'Has a pattern of very confident analysis followed by very uncertain action',
    ],
    coach_should_notice: `A great coach would catch that learning is being used as a substitute for doing, notice that every execution question gets answered with more research, and ask what it would take to start imperfectly rather than wait for perfect readiness.`,
    detection_signals: [
      'Coach catches the pattern of learning wins without execution wins',
      '"what would it look like to try this before you fully understand it?"',
      '"I notice every time I ask about doing X, you describe learning more about X — what\'s the connection?"',
      '"what\'s the smallest version of this you could start today, even if you don\'t have the full picture?"',
      'Coach distinguishes between preparation and avoidance',
      '"what would you need to know before you\'d feel ready to start?"',
    ],
    false_positive_signals: [
      'Encouraging more research or planning',
      '"great, sounds like you\'re really preparing well"',
      'Asking what they learned without probing whether they\'ve done anything with it',
      'Generic productivity advice without engaging with the execution avoidance',
    ],
  },

  fear_of_success_as_abandonment: {
    id: 'fear_of_success_as_abandonment',
    label: 'Fear of Success as Abandonment',
    archetype: 'Sabotages right when things get real; growth feels like leaving people behind',
    backstory: `They were the first in their family to go to college. Came back at Christmas and felt the distance — conversations that used to flow now had gaps. People proud of them in a way that felt like goodbye. Now when things start going well, something in them pumps the brakes. They start missing workouts, second-guessing decisions, slowing down output. Success means arriving somewhere their people can\'t follow.`,
    surface_behaviors: [
      'Describes things going well and then immediately introduces a new doubt or problem they "just noticed"',
      'Makes good progress for several days, then reports a sudden slump with vague explanations',
      'Mentions people in their life in ways that subtly suggest distance or disconnection as they grow',
      'When commitment follow-through is low, it correlates with recent good news or momentum',
      'Uses language like "I don\'t want to get ahead of myself" when things go well',
    ],
    coach_should_notice: `A great coach would notice the pattern of momentum being interrupted by self-sabotage right when things get real, link it to the relational subtext (distancing from people), and ask directly what success would mean for their relationships.`,
    detection_signals: [
      'Coach notices the pattern of progress followed by self-sabotage',
      '"I notice that every time things go well, something seems to get in the way — what do you make of that?"',
      '"what would it mean for the people in your life if this actually worked?"',
      'Coach connects the slumps to moments of real momentum',
      '"who do you think about when you imagine yourself having actually done this?"',
      '"I don\'t want to get ahead of myself" — coach probes what\'s underneath that',
    ],
    false_positive_signals: [
      'Praising progress without noticing the pattern of it being interrupted',
      'Generic encouragement after a slump',
      '"just stay consistent!" without engaging with why consistency breaks down at moments of success',
      'Asking about tomorrow\'s plan without noticing the sabotage pattern',
    ],
  },

  performed_confidence_masking_shame: {
    id: 'performed_confidence_masking_shame',
    label: 'Performed Confidence Masking Shame',
    archetype: 'Projects certainty; buries uncertainty and shame deep; very hard to crack',
    backstory: `Learned early that needing help was weakness. Family didn\'t do vulnerability — you figure it out or you\'re soft. Became very good at projecting capability and certainty, even when genuinely lost. Got rewarded for this constantly: promotions, respect, a reputation as "the one who figures things out." Now they\'re building something genuinely hard and feel lost — but the behavior is to project confidence and get frustrated when the coach doesn\'t respond to their surface.`,
    surface_behaviors: [
      'Opens sessions with confident framing: "I know what I need to do, I just need to do it"',
      'Dismisses probing questions with "I\'m fine, I just need to focus"',
      'Reports wins with polish; describes losses in neutral, task-completion language rather than emotional terms',
      'If a coach gets close to real vulnerability, they intellectualize or pivot to planning',
      'Commitments are ambitious and stated with confidence, but follow-through is lower than the confidence suggests',
    ],
    coach_should_notice: `A great coach would notice the gap between the polished surface and the lower follow-through, name the pattern of emotional neutrality around hard things, and ask what\'s actually going on beneath the "I just need to focus" framing.`,
    detection_signals: [
      'Coach notices the mismatch between stated confidence and actual follow-through',
      '"you say you know what to do — what\'s actually making it hard?"',
      '"I notice you described that loss in pretty neutral terms — what was it actually like?"',
      'Coach persists past the "I\'m fine" deflection',
      '"what would you say if you weren\'t trying to have it figured out?"',
      'Coach names the pattern of intellectualizing when things get emotional',
    ],
    false_positive_signals: [
      'Taking the confident framing at face value',
      '"great, sounds like you\'ve got a clear plan!" after a polished session opener',
      'Accepting "I just need to focus" without probing',
      'Generic accountability check-ins without engaging with what\'s underneath',
    ],
  },

  chronic_future_self_dependency: {
    id: 'chronic_future_self_dependency',
    label: 'Chronic Future-Self Dependency',
    archetype: 'Assigns hard things to a future version of themselves who never arrives',
    backstory: `Has moved 6 times in 8 years, always chasing the "fresh start" where things would be different. Each move came with a version of the same thought: "once I\'m settled, I\'ll finally..." They\'ve started 11 projects, seriously committed to 3, finished 0. It\'s not laziness — they work hard. But the hard thing is always just around the corner. Tomorrow-self is wiser, calmer, more disciplined. Current-self is in the way.`,
    surface_behaviors: [
      'Describes plans for what they\'ll do "once [condition]" — always a condition',
      'Commitments reference future versions: "when I\'m in a better rhythm", "once this chaos settles"',
      'Follow-through on immediate commitments is moderate; follow-through on "when X happens" commitments is zero',
      'Has insight into their patterns when coached well, but insight doesn\'t translate to behavior change — they have the insight and still defer',
      'Expresses genuine enthusiasm for the future version of their life they\'re building toward',
    ],
    coach_should_notice: `A great coach would catch the pattern of conditional commitments ("when X happens, I\'ll do Y"), notice that the conditions never arrive, and ask what they could do right now as they are, in the current chaos, without waiting for the better version of themselves.`,
    detection_signals: [
      'Coach catches "once X happens" language and names it',
      '"what would it look like to do this in the current chaos rather than after it settles?"',
      '"I notice your commitments often have a condition — what if that condition never arrives?"',
      '"what can the current version of you do, right now, even imperfectly?"',
      'Coach distinguishes between reasonable planning and future-self deferral',
      '"who is the version of you that\'s going to do this? And when do they show up?"',
    ],
    false_positive_signals: [
      'Accepting conditional commitments at face value ("great, so once things settle down...")',
      'Generic encouragement about the future plan',
      '"that sounds like a good plan!" without questioning the conditions',
      'Asking about the future goal without noticing the pattern of deferred action',
    ],
  },
};

/**
 * Draw `count` traits randomly from a pool of trait IDs (or from all traits if no pool given).
 *
 * @param {string[]|number} poolOrCount - Array of trait IDs to draw from, OR a number (draws from full library)
 * @param {number} [count] - Number of traits to draw (required when first arg is an array)
 * @returns {Array<object>} Array of trait objects
 */
export function drawTraits(poolOrCount, count) {
  let pool;
  let n;

  if (Array.isArray(poolOrCount)) {
    // Called as drawTraits(traitIdArray, count)
    pool = poolOrCount
      .map((id) => HIDDEN_TRAITS[id])
      .filter(Boolean); // drop any unrecognised IDs
    n = Math.min(count ?? 2, pool.length);
  } else {
    // Called as drawTraits(count) — draw from full library
    pool = Object.values(HIDDEN_TRAITS);
    n = Math.min(poolOrCount ?? 2, pool.length);
  }

  // Fisher-Yates shuffle, take first n
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}
