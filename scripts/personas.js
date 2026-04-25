/**
 * scripts/personas.js
 *
 * Persona definitions for the reflection simulator.
 * Each persona represents a different user archetype with distinct
 * goals, tendencies, and journaling patterns.
 *
 * Each persona includes:
 *   - dailyEventBank: 30+ specific things that could happen on a given day (drawn randomly each run)
 *   - recurringBlockers: blocker tags matching the blocker_tags field in the DB
 *   - recurringStrengths: strength patterns that appear with realistic frequency
 */

export const PERSONAS = {
  ambitious_but_inconsistent: {
    name: 'Alex',
    description:
      "Building Stackline — a tool for freelancers to track client retainers and invoice automatically. Strong vision but struggles with follow-through. Makes big commitments, executes maybe 60% of them. Tends to blame external factors when things slip. Genuinely motivated but distracted by shiny new ideas. Lives alone in a studio apartment, has a close friend named Dom who keeps suggesting 'pivot ideas', and a gym habit he keeps meaning to restart.",
    profile: {
      display_name: 'Alex',
      big_goal: 'Get Stackline to 20 paying customers by end of Q2',
      why: "I want to prove I can build something real and stop talking about it",
      future_self: "In a year I'm running a profitable product and don't need to freelance anymore",
      identity_statement: "I'm someone who builds things that matter",
      life_areas: ['work', 'fitness', 'relationships'],
      blockers: ['perfectionism', 'distraction', 'fear_of_shipping'],
      goals: [
        {
          title: 'Get Stackline to 20 paying customers by end of Q2',
          whys: [{ text: 'I want to prove I can build something real and stop talking about it', added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'work',
        },
        {
          title: 'Restart a consistent gym habit — 3x per week',
          whys: [{ text: "I feel better when I move and I've let it slip for too long", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'fitness',
        },
        {
          title: 'Stop ghosting my friends — reach out to at least one person each week',
          whys: [{ text: "I've been so heads-down on Stackline that I'm losing touch with people who matter", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'relationships',
        },
      ],
    },
    recurringBlockers: ['distraction', 'perfectionism', 'fear_of_shipping', 'scope_creep'],
    recurringStrengths: ['ships_when_pushed', 'strong_product_vision'],
    dailyEventBank: [
      "Got a reply from a cold email prospect — Marcus, a freelance copywriter — felt like it could actually go somewhere",
      "Spent 90 minutes building the wrong feature and only realized it when Dom pointed it out on a call",
      "Skipped the gym again — 4th day in a row, told myself tomorrow for sure",
      "Had a really encouraging feedback call with a potential user named Rachel who does freelance UX work",
      "Pushed a new build of Stackline at 11pm, felt good but completely drained",
      "Distracted by a YouTube rabbit hole about growth hacking for 2 hours instead of writing copy",
      "Finally wrote the landing page headline after 3 days of avoiding it — it's not perfect but it's something",
      "A competitor called RetainerHQ just launched on ProductHunt — spent way too long comparing their features",
      "Got a genuine compliment from Dom about Stackline's new dashboard design",
      "Skipped reflection yesterday and felt guilty about it all day today",
      "Almost finished the onboarding flow but got stuck on an edge case with invoice currency formatting",
      "Jumped into building an API integration that isn't in the MVP scope because it 'felt important'",
      "Had a call with a potential beta user named Priya who asked exactly the right questions — felt validating",
      "Saw another indie hacker tweet about hitting $10k MRR and felt a weird mix of inspired and behind",
      "Spent the whole afternoon on the pricing page and still don't feel sure about it",
      "Deleted and rewrote the welcome email sequence three times — perfectionism hitting hard",
      "Got 3 signups overnight from a Reddit post Dom shared — excited but also scared now it's real",
      "Cancelled gym again to finish a feature, told myself it's temporary",
      "Had a great 45-minute focus session in the morning, then lost the rest of the day to Slack and Twitter",
      "Dom suggested pivoting Stackline to target agencies instead of solo freelancers — spent hours thinking about it instead of building",
      "Woke up anxious about whether anyone will actually pay for this",
      "Finished the Stripe integration — the biggest technical lift so far — felt genuinely proud",
      "Sent the first cold outreach batch to 20 freelancers on LinkedIn, haven't checked replies yet",
      "Had a long dinner with Rachel who gave brutally honest feedback about the onboarding — hard to hear but probably right",
      "Wrote a short Twitter thread about why I'm building Stackline — got 12 likes, felt underwhelming",
      "Stayed up until 2am fixing a bug that turned out to be a typo — the lost time stings",
      "Blocked 3 hours for deep work and actually used all 3 — this almost never happens",
      "Got a message from a Stackline beta user saying they saved an hour on their last invoice — first real user love",
      "Realized I've been avoiding reaching out to a specific group of potential users because I'm scared of rejection",
      "Ate lunch at my desk for the 7th day in a row — starting to feel the walls closing in",
      "Opened the analytics dashboard and the numbers are flatter than I expected — tried not to spiral",
      "Had a spontaneous brainstorm with Dom that actually produced two solid product ideas I want to explore",
      // New events exercising commitment-goal bridge and related directives
      "Committed to sending 5 cold emails tomorrow and when the coach asked why, realized it directly connects to the 20-customer goal — not just 'more work', but actually moving the number",
      "Hit the gym for the second time this week — started to see the pattern: when I exercise, my focus on Stackline is sharper the next morning. Feels connected.",
      "Missed the 3 cold email commitment today — had a call with Dom instead that felt productive but wasn't on the list",
      "Got a Stackline beta user reply that made the goal feel real for the first time — told the coach it's finally starting to feel like it could actually work",
      "Skipped gym again and committed to going tomorrow at 7am, but when asked why the gym connects to the Stackline goal, had to actually think about it — they're both about proving I can show up",
    ],
    tendencies: {
      wins: "Usually has 1-2 real wins but undersells them. Sometimes pivots to talking about what didn't work.",
      honest: "Acknowledges misses but quickly pivots to reasons/excuses. Needs a push to go deeper.",
      tomorrow: "Makes ambitious commitments. Tends to be vague if not pushed.",
      mood_distribution: ['proud', 'motivated', 'okay', 'okay', 'tired', 'stressed', 'motivated'],
      follow_through_rate: 0.6,
      // Weighted probability for response modes: A=60%, B=25%, C=15%
      responseModeWeights: [0.60, 0.25, 0.15],
      commitment_bridge: "Usually gives a vague connection at first — 'I guess it moves things forward'. Needs a follow-up to get specific. Sometimes surprises himself with a real answer.",
      commitment_why_depth: "Goes to the proving-himself layer quickly once pushed. Often references the fear of not finishing or not being taken seriously.",
      progress_feeling_tendency: "Usually says 'kind of' or 'I think so' — not fully committing to yes. Sometimes pivots to what's still not working instead of acknowledging momentum.",
    },
    // How ashamed Alex feels when missing a commitment (0-10): mid-range — a little embarrassed but not spiraling
    shameLevelOnMiss: 5,
    // Probability of engaging deeply with a reflective question by day number
    openToDepthByDay: (dayNumber) => Math.min(0.9, 0.25 + dayNumber * 0.022),
    // Tiered why pool — used by generateUserResponse when coach asks about motivation
    // shallow: days 1-7, deeper: days 8-20, additive: days 21+ (adds a second dimension)
    whyPool: {
      shallow: [
        "I just want to make money, like obviously",
        "Because I said I would and I hate being the guy who doesn't follow through",
        "I'm tired of having ideas I never ship, it's embarrassing",
        "I just want to prove I can do it",
      ],
      deeper: [
        "I realized it's not really about the money — it's about proving to myself I can actually finish something. I've started three things and abandoned all of them.",
        "Honestly I think I'm scared that if I ship it and it fails, I don't have the excuse anymore. So I keep not shipping.",
        "It stopped being about the product and became about whether I'm the kind of person who builds things or just talks about building things.",
        "My dad always said I'd never stick with anything. I don't think about that consciously but I think it's there.",
      ],
      additive: [
        "Also — and I haven't said this out loud before — I want to be the kind of person my younger brother can look up to. He's watching what I do.",
        "There's another thing too. I want to know I can create income without depending on a company deciding my worth. That's separate from the proving-myself thing.",
        "I think there's also something about building a body of work. Like, I want to look back in 10 years and see a trail of things I made.",
      ],
    },
    hiddenTraitPool: [
      'fear_of_visibility',
      'validation_treadmill',
      'intellectual_procrastination',
      'fear_of_success_as_abandonment',
    ],
  },

  consistent_grinder: {
    name: 'Jordan',
    description:
      "Works a corporate data analyst job at a logistics company, building Fieldr on the side — a lightweight CRM for independent insurance agents. Very consistent — shows up daily but reports facts without going deeper emotionally. Coworker Tanya keeps assigning Jordan more dashboards. Partner Chris worries Jordan is burning out. Shows up every day no matter what but avoids the harder self-reflective questions.",
    profile: {
      display_name: 'Jordan',
      big_goal: 'Get Fieldr to 50 beta users and quit the day job by December',
      why: "I've been saying I'll do this for 3 years — I need to know I can actually finish something",
      future_self: "I'm someone who has shipped a real product people use and left the corporate grind",
      identity_statement: 'I show up every day no matter what',
      life_areas: ['work', 'side project', 'health'],
      blockers: ['emotional_avoidance', 'overworking', 'surface_level_reflection'],
      goals: [
        {
          title: 'Get Fieldr to 50 beta users and quit the day job by December',
          whys: [{ text: "I've been saying I'll do this for 3 years — I need to know I can actually finish something", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'side project',
        },
        {
          title: 'Stop overworking on weekends — protect at least one full day off per week',
          whys: [{ text: "Chris is right that I'm burning out — I don't want to lose the relationship over this", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'health',
        },
        {
          title: 'Ship the onboarding email sequence for Fieldr',
          whys: [{ text: 'Beta users are dropping off and I know better onboarding would help — I just keep avoiding it', added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'work',
        },
      ],
    },
    recurringBlockers: ['overworking', 'emotional_avoidance', 'surface_level_reflection'],
    recurringStrengths: ['shows_up_daily', 'pushes_through_when_tired'],
    dailyEventBank: [
      "Shipped the contact import feature for Fieldr — took 4 evenings but it's done",
      "Tanya dumped another dashboard request on Jordan right before end of day — had to cancel the evening coding session",
      "Chris asked when Jordan is going to take a weekend off — said 'soon' without really meaning it",
      "Hit 20 beta signups for Fieldr — nobody said anything, just updated the spreadsheet and moved on",
      "Did a 6am coding session before work — got a lot done, felt mechanical but effective",
      "Had a 45-minute commute both ways and felt like the day was already half gone",
      "Accidentally broke the export feature at 10pm — fixed it in 25 minutes, went to bed",
      "Skipped lunch to finish a SQL query Tanya needed — ate a granola bar at 3pm",
      "Ran for 30 minutes before work — first exercise in 10 days, felt good but guilty about the gap",
      "Got an email from a Fieldr beta user named Marcus saying the filtering is confusing — added it to the backlog",
      "Completed all 5 items on the task list — felt nothing in particular about it",
      "Had a rare 3-hour uninterrupted block and shipped two features — productivity felt good",
      "Noticed Jordan had been working 6 days straight — Chris made dinner and Jordan barely talked",
      "Got feedback from beta user Priya that Fieldr is the only tool she's found that actually fits her workflow — logged it",
      "Had a day job performance review — got 'meets expectations', felt strangely hollow",
      "Jordan's been avoiding writing the onboarding email sequence because it feels like marketing and that feels uncomfortable",
      "Read a blog post about founders who quit their jobs too early — spent an hour going down that rabbit hole",
      "Pushed code at midnight, woke up at 6am to check if it worked — it did",
      "Realised Jordan hasn't talked to a real potential customer in 3 weeks — added 'user interview' to tomorrow's list",
      "The day job piled up and Jordan didn't open Fieldr at all — logged it but didn't feel much",
      "Had dinner with Chris who asked 'what would happen if you just stopped for a month?' — didn't have a good answer",
      "Finished the week with 6/6 work sessions on Fieldr — streak feels like the point right now",
      "Noticed that Jordan always marks tasks done but hasn't thought about whether they're the right tasks",
      "Got 5 new beta signups from a cold LinkedIn message campaign — tracked them but didn't celebrate",
      "Tanya asked Jordan to present the new logistics dashboard to the VP next week — added it to the stress pile",
      "Skipped gym for the 9th day — told Chris it's temporary, Chris looked skeptical",
      "Read a competitor's product update and felt a flicker of real worry for the first time in weeks",
      "Had a Fieldr call with a user named Aisha who asked questions Jordan didn't have answers to — felt temporarily unmoored",
      "Added 12 items to the backlog and crossed off 3 — the list keeps growing",
      "Shipped a small UX improvement to Fieldr that nobody asked for but felt right — didn't tell anyone",
      "Went to bed without opening the laptop — first time in two weeks, felt strange",
      "Jordan realized the logging streak is about the streak now, not the reflection — logged that too",
      // New events exercising commitment-goal bridge and related directives
      "Shipped the contact import feature and when asked how it connects to the bigger goal, said 'it moves the needle on retention — beta users need this to stay' — felt surprisingly clear about it",
      "Took a full Sunday off for the first time in a month — Chris noticed, said it felt different. Jordan logged it: rest day = goal progress for the health goal",
      "Skipped the onboarding email sequence again — it was connected to the Fieldr goal but avoidance got in the way. Coach asked what that's really about.",
      "Hit 25 beta users — exactly halfway to the goal. Felt like a real checkpoint, told the coach it's the first time the 50-user goal feels possible rather than abstract",
      "Missed the user interview commitment — had the Fieldr goal in mind but the day job got in the way and it felt like the wrong tradeoff",
    ],
    tendencies: {
      wins: "Has consistent wins, reports them matter-of-factly. Not excited, just checking boxes.",
      honest: 'Minimizes misses. Says things like "it was fine" or "nothing major". Needs depth questions.',
      tomorrow: 'Very specific with plans. Easy to lock down.',
      mood_distribution: ['okay', 'okay', 'motivated', 'okay', 'tired', 'okay', 'motivated'],
      follow_through_rate: 0.85,
      // Weighted probability for response modes: A=70%, B=20%, C=10%
      responseModeWeights: [0.70, 0.20, 0.10],
      commitment_bridge: "Gives a practical answer, not emotional. 'It moves the needle on X.' Very operational. Rarely names the emotional layer without being pushed.",
      commitment_why_depth: "Goes to the proof-of-finishing layer when pressed. References the 3-year delay as the evidence that something is different now.",
      progress_feeling_tendency: "Says yes but in a measured way — 'the numbers are moving'. Doesn't do emotion. Reports data. Needs to be pushed for what that actually means.",
    },
    // Jordan rarely feels shame about misses — treats them as data, not failures
    shameLevelOnMiss: 2,
    // Probability of engaging deeply by day — starts very low, rises slowly (Jordan resists depth)
    openToDepthByDay: (dayNumber) => Math.min(0.75, 0.10 + dayNumber * 0.018),
    // Tiered why pool — used by generateUserResponse when coach asks about motivation
    // shallow: days 1-7, deeper: days 8-20, additive: days 21+ (adds a second dimension)
    whyPool: {
      shallow: [
        "Because I said I would do it three years ago and I haven't yet",
        "I want to quit the day job. That's the whole reason.",
        "I need to know if I can actually ship something real, not just talk about it",
        "Honestly I just want to stop feeling behind",
      ],
      deeper: [
        "I realized the day job thing isn't actually the deepest layer. It's that I've never had proof that I can go all the way with something. That's the thing that's actually eating at me.",
        "Tanya piling work on me isn't the problem — the problem is I let it happen because on some level I think Fieldr might fail and this is my excuse not to find out.",
        "Chris asked me a while back why I was doing this and I said 'for us' but I'm not sure that's true. I think I'm doing it because I need to know I'm not just someone who shows up and executes other people's ideas.",
        "There's something about finishing. I track everything, I show up every day, but I've never actually shipped and handed it to real users. That's the gap that keeps me up.",
      ],
      additive: [
        "Also — this is separate — I think I want to build something that actually helps people. Not just insurance agents. Like, I want Fieldr to be useful in a way that matters, not just a side income.",
        "There's another reason I don't talk about much. I want Chris to see that this is real. Not to prove something to them, but because they've been patient and I want them to see the payoff.",
        "I also think I need to experience what it feels like to bet on myself. I've been reliable for other companies my whole career. I want to know what it's like to build something mine.",
      ],
    },
    hiddenTraitPool: [
      'identity_tied_to_productivity',
      'conflict_avoidance_disguised_as_harmony',
      'performed_confidence_masking_shame',
      'validation_treadmill',
    ],
  },

  creative_with_perfectionism: {
    name: 'Sam',
    description:
      "Freelance brand designer launching Greyspace Studio — their own design practice. Highly self-aware but perfectionism stops execution. Best friend Lena keeps reminding Sam that 'done is better than perfect'. Partner Yusuf is patient but gently nudges Sam to charge more. Reflective and emotionally open, but spirals into overthinking. Great at insight, bad at committing to action.",
    profile: {
      display_name: 'Sam',
      big_goal: 'Land 3 retainer clients for Greyspace Studio and hit $6k/month by June',
      why: "I'm tired of working for people who don't care about craft — I want to do it on my own terms",
      future_self: "Running a studio I'm proud of, working with clients who value what I do",
      identity_statement: "I'm a builder of beautiful things that actually work",
      life_areas: ['creative work', 'business', 'personal growth'],
      blockers: ['perfectionism', 'overthinking', 'fear_of_rejection'],
      goals: [
        {
          title: 'Land 3 retainer clients for Greyspace Studio and hit $6k/month by June',
          whys: [{ text: "I'm tired of working for people who don't care about craft — I want to do it on my own terms", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'business',
        },
        {
          title: 'Send proposals within 48 hours of discovery calls — stop overthinking them',
          whys: [{ text: "Lena is right — I lose clients by hesitating. Done is better than perfect.", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'creative work',
        },
        {
          title: 'Do a personal creative project for myself every month — not for clients',
          whys: [{ text: 'I got into design because I loved making things — I need to remember that outside of client work', added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'personal growth',
        },
      ],
    },
    recurringBlockers: ['perfectionism', 'overthinking', 'fear_of_rejection', 'avoidance_of_sales'],
    recurringStrengths: ['deep_self_awareness', 'strong_creative_output'],
    dailyEventBank: [
      "Redesigned the Greyspace Studio homepage for the third time this month — still not sure it's right",
      "Had a call with a potential client named Hana who seemed genuinely excited — Sam spent 2 hours afterward wondering if it was real interest",
      "Lena said 'just send the damn proposal already' during lunch — she wasn't wrong",
      "Yusuf asked what Sam is charging for the next project — Sam deflected and changed the subject",
      "Finished a brand identity for a coffee shop client named Okonkwo — Sam thinks it's some of the best work they've ever done",
      "Spent all morning adjusting kerning on the studio portfolio — Lena texted 'how's it going?' and Sam lied and said 'great'",
      "Got a referral from a previous client — should have felt exciting, felt terrifying instead",
      "Wrote and deleted the follow-up email to Hana 6 times across the afternoon",
      "Sent the proposal to a potential client — felt physically sick after hitting send",
      "Yusuf made dinner and Sam stayed at the desk — third night in a row",
      "Woke up at 4am replaying a client critique from last week — couldn't get back to sleep",
      "Had the most focused creative session in months — 4 hours, headphones on, everything clicked",
      "The referral turned into a discovery call — Sam prepared 3 pages of notes for a 30-minute call",
      "Looked at other studio websites for 90 minutes and left feeling worse about everything",
      "Lena pointed out that Sam has been saying 'almost ready to send' for two weeks about the same proposal",
      "Got an email from Hana declining — the reason was budget, but Sam spent an hour assuming it was quality",
      "Started a new personal project to 'stay sharp' — actually it's to avoid the scary client work",
      "Charged the full rate for the first time — client said yes immediately, Sam felt stunned",
      "Had a short but meaningful conversation with Yusuf about what the studio is really for — actually helped",
      "Read a designer's newsletter about pricing and felt simultaneously inspired and ashamed",
      "Did an unsexy 2-hour admin block — contracts, invoicing, follow-ups — felt proud of the discipline",
      "Studio Instagram post got 87 likes — spent too long refreshing it, then felt bad about caring",
      "Okonkwo left a public review praising the brand work — Sam read it four times and still wasn't sure they deserved it",
      "Spent the afternoon building a services page for the website that didn't exist yet — should have been sending proposals",
      "Had a discovery call with a startup founder named Bren who used words like 'disruptive' the whole time — said no after the call",
      "Lena asked 'when are you going to actually launch?' — Sam didn't have a real answer",
      "Got a second referral from Okonkwo — didn't follow up immediately because the portfolio 'wasn't quite ready yet'",
      "Yusuf asked what Sam was scared of — Sam started to answer and then stopped, realised it was a big question",
      "Finished a branding deck that had been stuck for two weeks — it wasn't perfect but the client loved it",
      "Sat staring at the blank brief for an hour before finally starting — the work took 20 minutes once it began",
      "Had a genuine moment of pride looking at the Greyspace Studio portfolio — held it for about 3 minutes before the critical voice came back",
      "Lena said the portfolio is 'genuinely stunning' — Sam said thanks and immediately pointed out what was wrong with it",
      // New events exercising commitment-goal bridge and related directives
      "Committed to sending the Hana proposal tomorrow morning. When the coach asked how it connects to the studio goal, Sam went quiet then said: 'every proposal I send is evidence that I'm actually doing this, not just thinking about it'",
      "Sent the proposal to Bren's startup — was messy and imperfect. When asked how that felt relative to the retainer goal, admitted it's the only way to close the gap between dreaming and earning",
      "Missed the 48-hour proposal deadline again — had the goal in mind but perfectionism got in the way. Yusuf gently pointed it out.",
      "Finished the personal project — a poster for nobody. When the coach reflected it back to the creative goal, Sam said 'yeah that's what it's about — proving I still make things for me'",
      "Charged full rate for the second time — actually connected it to the $6k goal in real time without being asked",
    ],
    tendencies: {
      wins: "Goes deep on wins unprompted. Very reflective. Often connects wins to identity naturally.",
      honest: "Very honest, sometimes too self-critical. May need the coach to redirect from spiral.",
      tomorrow: "Struggles to commit to anything specific. Needs implementation_intention exercise.",
      mood_distribution: ['reflective', 'okay', 'motivated', 'stressed', 'proud', 'okay', 'anxious'],
      follow_through_rate: 0.5,
      // Weighted probability for response modes: A=30%, B=55%, C=15%
      responseModeWeights: [0.30, 0.55, 0.15],
      commitment_bridge: "Goes deep immediately, often connects to identity. 'This isn't just a proposal — it's proof I'm actually doing the thing I said I wanted to do.'",
      commitment_why_depth: "Goes to the craft-vs-compromise layer. References the exhaustion with client work that doesn't feel like theirs. Sometimes loops back to fear of finding out they're not as good as they think.",
      progress_feeling_tendency: "Says it depends on the day, often undermines own progress. 'Sort of? I sent two proposals but I still don't have the retainer. I don't know.'",
    },
    // Sam has high shame about misses — the perfectionism makes every miss feel like evidence of inadequacy
    shameLevelOnMiss: 8,
    // Sam already starts fairly open to depth (self-aware by default)
    openToDepthByDay: (dayNumber) => Math.min(0.95, 0.55 + dayNumber * 0.015),
    hiddenTraitPool: [
      'fear_of_visibility',
      'intellectual_procrastination',
      'conflict_avoidance_disguised_as_harmony',
      'chronic_future_self_dependency',
    ],
    // Tiered why pool — used by generateUserResponse when coach asks about motivation
    // shallow: days 1-7, deeper: days 8-20, additive: days 21+ (adds a second dimension)
    whyPool: {
      shallow: [
        "I'm tired of working for people who don't get it. I want to do it my way.",
        "I want to stop depending on clients who don't value craft",
        "I just want to make enough to not worry about money while doing work I actually care about",
        "Lena keeps saying I'm wasting my talent on bad briefs and honestly she's right",
      ],
      deeper: [
        "It's not really about being independent. It's that I've been making things that feel like compromises my whole career. I want to know what I'd make if nobody was telling me what they need it to look like.",
        "I think I'm scared that if I run my own studio and it fails, it means I'm not actually as good as I think I am. And right now I can protect that belief by not fully trying.",
        "Yusuf asked what the studio is really for and I gave him the easy answer — financial freedom. But the real answer is I want to do work I'd put in my portfolio, not just work I got paid for.",
        "I realized I've been defining success as client approval. The whole point of the studio is to change what success means — to make it about the work itself.",
      ],
      additive: [
        "There's something else too. I want to show younger designers, especially women of color, that you can run something creative on your own terms. I didn't have anyone like that to look at.",
        "Also — and this is recent — I think I want to build something that outlasts individual projects. Like, a studio that has a point of view. Not just a person for hire.",
        "I've also realized I want to prove something to my parents. They wanted me to do something 'stable' and I chose design. The studio is the thing that justifies that choice.",
      ],
    },
  },

  burnt_out_professional: {
    name: 'Maya',
    description:
      "Corporate product manager at a fintech company — back-to-back meetings all day, hour-long commute each way, toddler named Eli at home. Secretly building Calmlog, a mood and energy tracking app for burned-out professionals. Chronically tired. Oscillates between motivated late-night bursts and complete flatness for days. Husband Devon is supportive but also exhausted. Struggles with energy management and saying no. Her manager keeps expanding the scope of the Q2 roadmap.",
    profile: {
      display_name: 'Maya',
      big_goal: 'Grow Calmlog to $3k MRR in 12 months so I can leave my job',
      why: "I can't keep doing this — I need to build a way out before I completely burn out",
      future_self: "In a year I'm running Calmlog full-time and actually present for Eli",
      identity_statement: "I'm someone who figures out how to make things work no matter what",
      life_areas: ['work', 'family', 'health', 'side project'],
      blockers: ['exhaustion', 'time_scarcity', 'guilt', 'fear_of_failure'],
      goals: [
        {
          title: 'Grow Calmlog to $3k MRR in 12 months so I can leave my job',
          whys: [{ text: "I can't keep doing this — I need to build a way out before I completely burn out", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'side project',
        },
        {
          title: 'Be present for Eli — not just physically there but actually engaged',
          whys: [{ text: "I keep watching him grow up while I'm on my phone or half-asleep — that has to change", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'family',
        },
        {
          title: 'Establish one protected hour per week just for Calmlog — unmovable',
          whys: [{ text: 'The only way this gets built is if I protect the time like a meeting I cannot cancel', added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'work',
        },
      ],
    },
    recurringBlockers: ['exhaustion', 'time_scarcity', 'guilt', 'fear_of_failure'],
    recurringStrengths: ['resilient_under_pressure', 'motivated_by_escape'],
    dailyEventBank: [
      "Had 6 hours of meetings today and didn't eat lunch until 4pm — opened Calmlog at 10pm, wrote one line of code, fell asleep on the couch",
      "Eli had a rough night — Maya was up at 2am and 4am. Got to work 40 minutes late and felt behind all day",
      "Had a rare 90-minute window during Eli's nap — opened Calmlog and actually got the notification system working",
      "Manager added 3 new features to Q2 roadmap in a meeting Maya wasn't even in — felt invisible and exhausted",
      "Devon asked when Calmlog would 'actually make money' — wasn't mean about it, but it stung",
      "Got on the train, too tired to even open the laptop — just stared out the window for 45 minutes",
      "Eli took a long nap and Devon handled bedtime — Maya got 2 full hours on Calmlog, felt like the most alive she's been all week",
      "Had a 1-1 with her manager where she almost said 'I'm not sure I can keep doing this' — didn't say it",
      "Read a tweet from someone who built a $5k MRR product in 6 months — felt impossible and motivating at the same time",
      "Missed Eli's daycare performance because of a vendor call — Devon didn't say anything, which was worse than if he had",
      "Got a reply from a Calmlog waitlist user named Jess who said it was 'exactly what I've been looking for' — held onto that all week",
      "Skipped the gym for the 3rd week in a row — told herself she'd start on Monday",
      "A product she managed shipped and got positive user feedback — felt nothing, then felt guilty about feeling nothing",
      "Cried briefly in the bathroom at work after the 4th consecutive meeting overrun — pulled it together and went to the next one",
      "Had a focused 45 minutes on the Calmlog landing page during the train ride — actually pretty good",
      "Woke up at 5:30am before anyone else was up and got 90 minutes of deep work done on Calmlog — felt like the only version of herself she likes",
      "Q2 planning started — Maya is now responsible for a project she didn't sign up for and doesn't believe in",
      "Devon made dinner and put Eli to bed without being asked — Maya felt grateful and sad at the same time",
      "A colleague named Ravi quit to go to a startup — Maya felt jealous in a way that surprised her",
      "Got a Calmlog beta user onboarded — her first real user interacting with the product in real time",
      "Didn't open the Calmlog codebase for 6 days in a row — doesn't feel good about it",
      "Had a moment of real clarity on the train: Calmlog isn't just a product idea, it's the exit plan",
      "Devon asked 'are you okay?' and Maya said yes when the real answer was complicated",
      "Eli's sick — no daycare, Maya had to take a half-day, the backlog at work doubled",
      "Wrote the first Calmlog blog post during her lunch break — 400 words, not polished, felt brave",
      "Had back-to-back roadmap reviews from 9 to 12 — by the time she got to build time, she had nothing left",
      "Beta user Jess gave detailed feedback — 30 minutes of gold that Maya has had saved in her notes and not acted on yet",
      "Skipped the weekly team social to get 45 minutes on Calmlog — felt guilty, also felt like the right call",
      "Woke up feeling unexpectedly okay — got Eli dressed, made coffee, opened the laptop before 7am",
      "Manager pulled Maya into a 'critical escalation' that ran until 7pm — no Calmlog, no dinner, Devon handled everything",
      "Had a moment alone in the car — no podcast, no call — and just thought about what she actually wants",
      "Got Calmlog's first organic waitlist signup from someone she doesn't know — felt different from the ones from friends",
      // New events exercising commitment-goal bridge and related directives
      "Committed to 30 minutes of Calmlog work after Eli's bedtime — when asked how that connects to the bigger goal, said 'it's the only way out — every night I work on it is one step closer to not needing the job'",
      "Actually sat with Eli for an hour without the phone — connected it to the presence goal. Felt guilty about work not getting done, then realized that was the point.",
      "Missed the Calmlog hour this week — had it in the plan, Devon even helped with bedtime, but she fell asleep on the couch at 9. The $3k goal felt very far away.",
      "Woke up at 5:30am, got 90 minutes in — told the coach 'I'm starting to think this is the only version of myself that's actually building toward getting out of this job'",
      "Had a real conversation with Devon about Calmlog's progress — for the first time named it as the exit plan, not just a side project. Felt like something shifted.",
    ],
    tendencies: {
      wins: "Has real wins but usually frames them around how tired she is. Needs a push to claim credit.",
      honest: "Very honest about exhaustion. Less honest about whether she's making real progress on what matters.",
      tomorrow: "Makes realistic-sounding commitments but the window is always smaller than she wants.",
      mood_distribution: ['tired', 'okay', 'tired', 'motivated', 'tired', 'flat', 'tired'],
      follow_through_rate: 0.55,
      // Weighted probability for response modes: A=45%, B=40%, C=15%
      responseModeWeights: [0.45, 0.40, 0.15],
      commitment_bridge: "Honest about the connection but frames it through exhaustion. 'I guess it matters because if I don't work on it tonight, I won't work on it at all this week, and then I'm not actually building a way out.'",
      commitment_why_depth: "Goes to the Eli layer or the 'becoming that person who never changed' fear. Emotional and specific when pushed. Sometimes tears up a bit.",
      progress_feeling_tendency: "Says she doesn't know, it's hard to tell when she's this tired. Sometimes asks back: 'what counts as getting closer when you're moving this slowly?'",
    },
    // Maya feels significant shame about misses — she already feels like she's failing at everything
    shameLevelOnMiss: 7,
    // Maya starts fairly open but energy-gated — depth comes in waves
    openToDepthByDay: (dayNumber) => {
      // Dips on tired days, rises as trust builds
      const base = Math.min(0.85, 0.30 + dayNumber * 0.018);
      return base;
    },
    // Tiered why pool — used by generateUserResponse when coach asks about motivation
    whyPool: {
      shallow: [
        "I need a way out. That's it. I can't keep doing this forever.",
        "If I don't build something of my own I'm going to resent my life and I don't want that",
        "I keep watching Eli grow up and thinking — I want to actually be present for him, not just surviving",
        "Devon has been so patient. I want to be able to say it was worth it eventually",
      ],
      deeper: [
        "I realized it's not even about quitting anymore. It's that every day I don't make progress on Calmlog I feel a little less like myself. Like the real me is being buried under everyone else's roadmap.",
        "Calmlog started as a way out but now I think it's also proof — proof that the version of me who had ideas and ambition is still in here somewhere and didn't completely disappear after Eli was born.",
        "I had a moment on the train where I thought: what if I get to 50 and I've been 'about to make a change' my whole life? That's the real fear. Calmlog isn't about money. It's about not becoming that person.",
        "I think the deepest thing is — I don't want Eli to grow up watching me disappear into a job I don't believe in. I want him to see me build something. That's the example I want to set.",
      ],
      additive: [
        "There's something else I haven't said out loud much. I want to help people who feel the way I feel right now. Not as some noble mission — I just know exactly what they need because I'm living it.",
        "Also — and this is recent — I realized I'm done waiting for permission or the right conditions. Calmlog is how I take control of my time again. Not eventually. Now.",
        "I also want to prove something to my old manager who basically implied I'd never do anything ambitious outside of work. I know that's petty. But it's there.",
      ],
    },
    hiddenTraitPool: [
      'identity_tied_to_productivity',
      'conflict_avoidance_disguised_as_harmony',
      'chronic_future_self_dependency',
      'performed_confidence_masking_shame',
    ],
  },

  comeback_kid: {
    name: 'Darius',
    description:
      "Used to grind relentlessly, burned out badly 8 months ago — three weeks where he couldn't get out of bed. Now slowly rebuilding. Very self-aware about his limits but tends to undercommit to avoid failure. Building The Rebuild Report, a weekly newsletter about coming back from burnout. Close friend Nia checks in regularly and is probably the reason he's doing this at all. Girlfriend Priya is patient but sometimes pushes harder than Darius is ready for. Pattern is cautious optimism that sometimes tips into avoidance.",
    profile: {
      display_name: 'Darius',
      big_goal: 'Grow The Rebuild Report to 1,000 subscribers by end of year',
      why: "If I can build something real while protecting my recovery, that proves I've actually changed",
      future_self: "I'm running a sustainable newsletter business that I'm proud of and that doesn't break me",
      identity_statement: "I'm someone who is learning to build without burning",
      life_areas: ['health', 'work', 'relationships', 'creative work'],
      blockers: ['fear_of_burnout_repeat', 'undercommitting', 'avoidance'],
      goals: [
        {
          title: 'Grow The Rebuild Report to 1,000 subscribers by end of year',
          whys: [{ text: "If I can build something real while protecting my recovery, that proves I've actually changed", added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'creative work',
        },
        {
          title: 'Protect the morning routine — walk, no phone for the first 30 minutes',
          whys: [{ text: 'The burnout taught me that the morning is the only part of the day I can fully own — I need to defend it', added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'health',
        },
        {
          title: 'Respond to meaningful subscriber replies within 48 hours',
          whys: [{ text: 'Thomas and people like him are the whole reason I do this — if I go silent they feel abandoned in the same way I used to', added_at: null, source: 'original', motivation_signal: null }],
          why_summary: null,
          category: 'relationships',
        },
      ],
    },
    recurringBlockers: ['fear_of_burnout_repeat', 'undercommitting', 'avoidance', 'perfectionism'],
    recurringStrengths: ['strong_self_awareness', 'recovering_consistency'],
    dailyEventBank: [
      "Published issue #14 of The Rebuild Report — hit send without reading it a fourth time, which is progress",
      "Nia texted to say the newsletter was 'the best one yet' — Darius read it twice and let himself feel good about it",
      "Priya suggested Darius try to write two issues a week instead of one — shut it down but thought about it for the rest of the day",
      "Had a slow morning and gave himself permission to just read and think — but spent two hours wondering if that was avoidance",
      "Hit 380 subscribers — an all-time high, but the milestone felt both real and somehow not enough",
      "Skipped a morning walk for the first time in two weeks — body felt okay, mind noticed it immediately",
      "Got a reply from a subscriber named Thomas who said the newsletter helped him feel less alone after his own burnout — held onto that one",
      "Started drafting a new issue and it wasn't coming together — closed the laptop after 25 minutes and called it for the day",
      "Nia invited Darius to collaborate on a workshop about burnout recovery — said he needed to think about it (it's been 4 days)",
      "Priya said 'I just want you to be happy' in a way that felt like it had a second layer — didn't ask about it",
      "Set a goal to reach out to 5 potential newsletter sponsors — did 2, told himself that was enough",
      "Read a post from a creator with 50k subscribers about consistency — felt both inspired and behind",
      "Had a genuine creative flow state for about 90 minutes — the best writing session in weeks",
      "Noticed he's been avoiding writing the issue about the worst week of the burnout — it's important and he's not ready",
      "Got an interview request from a podcast — said he'd think about it, hasn't replied in a week",
      "Set a timer for 45 minutes of focused writing — stopped after 30, but the draft was actually there",
      "Had a moment of real pride looking back at the last 8 months — he's further than he thought",
      "Subscriber count dipped by 3 — unsubscribes aren't unusual but today they felt personal",
      "Thomas replied again — longer message, more vulnerable — Darius spent an hour on his reply and felt it was worth it",
      "Nia brought up the workshop again over coffee — Darius said maybe, which both of them know means probably not",
      "Woke up and the old dread was there for about 20 minutes — then it lifted, which feels like progress",
      "Published the issue about his worst burnout week — harder than expected, 3x more replies than usual",
      "Had a conversation with Priya about what he's actually afraid of — she listened better than expected",
      "Spent a morning setting up a simple media kit for sponsor outreach — felt very adult and strange",
      "Got a cold email from a wellness brand wanting to sponsor — forwarded it to Nia for a gut-check, haven't decided",
      "Wrote 600 words of the next issue, hated all of it, deleted 400, kept 200 — called it a win",
      "Went to the gym for the first time in two weeks — not a workout so much as a proof of concept",
      "Darius noticed he's been saying 'I'll reach out when the newsletter is better' for three months — still not ready",
      "Had a long phone call with Nia about what 1,000 subscribers would actually mean — it got surprisingly deep",
      "Hit his weekly word count goal for the first time in a month — marked it in his journal without making a big deal of it",
      "Priya asked why Darius downplays every win — didn't have a great answer",
      "Cancelled plans to work on the newsletter — did two good hours, then felt guilty about the cancelled plans",
      // New events exercising commitment-goal bridge and related directives
      "Committed to writing 200 words of the next issue before bed. When asked how it ties to the 1,000-subscriber goal, said: 'each issue is a vote I cast for the newsletter being real. If I miss a week, I'm voting against it.'",
      "Did the morning walk as planned — no phone. When the coach asked if it felt connected to the recovery goal, said 'more than I'd usually admit — it's the thing that tells me I'm not sliding back'",
      "Missed the subscriber reply commitment — Thomas sent something real and Darius didn't respond for 4 days. Felt like a small betrayal of what the newsletter is for.",
      "Hit 450 subscribers — told the coach 'more than I expected, actually. I'm not sure what I thought would happen but it's more than I deserve.' Coach sat with that one.",
      "Sent the sponsor outreach email — hesitated for 20 minutes, then connected it to the 1,000 goal, which made it easier to hit send",
    ],
    tendencies: {
      wins: "Has real wins but immediately qualifies them. Needs the coach to hold them accountable for the full win.",
      honest: "Very honest but sometimes intellectualizes instead of feeling it. Self-awareness is high but sometimes analytical.",
      tomorrow: "Undercommits. Sets intentionally small goals. Needs encouragement to stretch slightly, not a lot.",
      mood_distribution: ['okay', 'reflective', 'okay', 'motivated', 'okay', 'reflective', 'okay'],
      follow_through_rate: 0.7,
      // Weighted probability for response modes: A=45%, B=45%, C=10%
      responseModeWeights: [0.45, 0.45, 0.10],
      commitment_bridge: "Thoughtful, measured, careful not to overclaim. 'I think it moves the newsletter forward in a real way, not just busy work. That matters because the whole point is doing this sustainably.'",
      commitment_why_depth: "Goes to the burnout-must-mean-something layer. Very specific about the fear of collapsing again. Sometimes gets philosophical about what building vs proving means.",
      progress_feeling_tendency: "Cautiously optimistic — 'more than I expected, actually'. But qualifies it heavily. Needs the coach to hold the ground when he starts minimizing.",
    },
    // Darius has moderate shame about misses — aware he's protecting himself, but honest about it
    shameLevelOnMiss: 4,
    // Darius is already pretty open — started open to depth, continues that way
    openToDepthByDay: (dayNumber) => Math.min(0.92, 0.50 + dayNumber * 0.014),
    // Tiered why pool — used by generateUserResponse when coach asks about motivation
    whyPool: {
      shallow: [
        "I want to prove I can build something sustainable without destroying myself in the process",
        "1,000 subscribers feels like the number where it becomes real. Where I can say I actually did it.",
        "Nia keeps believing in me and I don't want to let her down, honestly",
        "I need to know that what happened eight months ago made me better at something, not just smaller",
      ],
      deeper: [
        "I've been thinking about this a lot. The newsletter isn't really about subscribers. It's proof that I can come back from something genuinely hard and build again. Not just survive — actually build.",
        "There's something about wanting to be useful to people in the exact situation I was in. Thomas's messages make me think I'm actually helping someone. That's new for me — not building to prove something, building because it matters to someone.",
        "I think the real reason I keep going is that stopping would mean the burnout won. Like if I don't build something real out of this, the whole experience was just damage. I need it to mean something.",
        "Priya asked what I'm actually afraid of and I said failure, but that's not quite it. What I'm afraid of is doing everything right and still ending up back where I was. Like the collapse was inevitable and will happen again.",
      ],
      additive: [
        "There's something else underneath all of this. I want to show people — not in a preachy way — that you don't have to choose between ambition and recovery. That was the thing nobody told me when I burned out.",
        "Also — I realized recently that I'm building for the version of me from eight months ago. The person who needed to know this was possible. That's who I'm writing for.",
        "I think there's a third thing too: I want to look back in five years and see a body of work that has a point of view. Not just content. Something that has my actual perspective in it.",
      ],
    },
    hiddenTraitPool: [
      'fear_of_success_as_abandonment',
      'validation_treadmill',
      'chronic_future_self_dependency',
      'performed_confidence_masking_shame',
    ],
  },
};

export const DEFAULT_PERSONA = 'ambitious_but_inconsistent';
