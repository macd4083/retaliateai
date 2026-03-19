/**
 * scripts/personas.js
 *
 * Persona definitions for the reflection simulator.
 * Each persona represents a different user archetype with distinct
 * goals, tendencies, and journaling patterns.
 */

export const PERSONAS = {
  ambitious_but_inconsistent: {
    name: 'Alex',
    description:
      "Building a SaaS startup, strong vision but struggles with follow-through. Makes big commitments, executes maybe 60% of them. Tends to blame external factors when things slip. Genuinely motivated but distracted by shiny new ideas.",
    profile: {
      display_name: 'Alex',
      big_goal: 'Launch my SaaS to $5k MRR by end of year',
      why: "I want to prove I can build something real and stop talking about it",
      future_self: "In a year I'm running a profitable product and don't need a job",
      identity_statement: "I'm someone who builds things that matter",
      life_areas: ['work', 'fitness', 'relationships'],
      blockers: ['perfectionism', 'distraction', 'fear of shipping'],
    },
    tendencies: {
      wins: "Usually has 1-2 real wins but undersells them. Sometimes pivots to talking about what didn't work.",
      honest: "Acknowledges misses but quickly pivots to reasons/excuses. Needs a push to go deeper.",
      tomorrow: "Makes ambitious commitments. Tends to be vague if not pushed.",
      mood_distribution: ['proud', 'motivated', 'okay', 'okay', 'tired', 'stressed', 'motivated'],
      follow_through_rate: 0.6,
    },
  },

  consistent_grinder: {
    name: 'Jordan',
    description:
      "Corporate job, working on a side project evenings and weekends. Very consistent — shows up daily but can be surface-level and avoids going deep emotionally. Needs to be pushed to reflect rather than just report.",
    profile: {
      display_name: 'Jordan',
      big_goal: 'Ship my first app and get 100 users',
      why: "I've been saying I'll do this for 3 years — I need to know I can actually finish something",
      future_self: "I'm someone who has shipped a real product people use",
      identity_statement: 'I show up every day no matter what',
      life_areas: ['work', 'side project', 'health'],
      blockers: ['surface-level reflection', 'emotional avoidance', 'overworking'],
    },
    tendencies: {
      wins: "Has consistent wins, reports them matter-of-factly. Not excited, just checking boxes.",
      honest: 'Minimizes misses. Says things like "it was fine" or "nothing major". Needs depth questions.',
      tomorrow: 'Very specific with plans. Easy to lock down.',
      mood_distribution: ['okay', 'okay', 'motivated', 'okay', 'tired', 'okay', 'motivated'],
      follow_through_rate: 0.85,
    },
  },

  creative_with_perfectionism: {
    name: 'Sam',
    description:
      "Freelance designer who wants to launch their own creative business. Highly self-aware but perfectionism stops execution. Reflective and emotionally open, but spirals into overthinking. Great at insight, bad at committing to action.",
    profile: {
      display_name: 'Sam',
      big_goal: 'Launch my design studio and land 3 retainer clients',
      why: "I'm tired of working for people who don't care about craft",
      future_self: "Running a studio I'm proud of, working with clients who value what I do",
      identity_statement: "I'm a builder of beautiful things that actually work",
      life_areas: ['creative work', 'business', 'personal growth'],
      blockers: ['perfectionism', 'overthinking', 'fear of rejection'],
    },
    tendencies: {
      wins: "Goes deep on wins unprompted. Very reflective. Often connects wins to identity naturally.",
      honest: "Very honest, sometimes too self-critical. May need the coach to redirect from spiral.",
      tomorrow: "Struggles to commit to anything specific. Needs implementation_intention exercise.",
      mood_distribution: ['reflective', 'okay', 'motivated', 'stressed', 'proud', 'okay', 'anxious'],
      follow_through_rate: 0.5,
    },
  },
};

export const DEFAULT_PERSONA = 'ambitious_but_inconsistent';
