/**
 * api/classify-intent.js
 *
 * Fast intent classifier — runs on every incoming message before the main
 * reflection-coach response is generated.  Uses gpt-4o-mini with low
 * max_tokens so it completes in ~300–600 ms.
 *
 * Returns a JSON object describing:
 *   intent, energy_level, accountability_signal, emotional_state,
 *   checklist_content, suggested_exercise
 *
 * Exercise routing rules (encoded in the prompt):
 *   excuse detected           → ownership_reframe
 *   low energy + frustrated   → gratitude_anchor
 *   stuck / don't know want   → values_clarification
 *   motivation block (vent)   → why_reconnect
 *   self-doubt / imposter     → evidence_audit
 *   procrastination pattern   → implementation_intention
 *   celebrate / proud         → identity_reinforcement
 *   overwhelmed               → triage_one_thing
 *   reflective / philosophical→ future_self_bridge
 *   memory_query              → none
 *   checkin with no signals   → none
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CLASSIFIER_SYSTEM = `You are a message intent classifier for a nightly reflection coaching app.

Classify the user message and return ONLY valid JSON matching this exact shape:
{
  "intent": "<checkin|vent|question|advice_request|memory_query|stuck|celebrate|off_topic>",
  "energy_level": "<low|medium|high>",
  "accountability_signal": "<excuse|ownership|neutral>",
  "emotional_state": "<frustrated|proud|anxious|flat|motivated|overwhelmed|reflective>",
  "checklist_content": {
    "wins": <true|false>,
    "honest": <true|false>,
    "plan": <true|false>,
    "identity": <true|false>
  },
  "suggested_exercise": "<none|gratitude_anchor|why_reconnect|evidence_audit|implementation_intention|values_clarification|future_self_bridge|ownership_reframe|triage_one_thing|identity_reinforcement>"
}

ACCOUNTABILITY SIGNAL RULES:
- excuse: The user actively deflects personal responsibility — e.g. "I couldn't because X happened", passive voice about their own failures where they had agency, or framing external events as the reason they didn't act when they clearly had a choice.
  DO NOT mark as excuse: simply mentioning that something hard happened today, naming a real external obstacle while still owning the miss ("work blew up and I dropped the ball"), or factual context-setting without blame language.
- ownership: "I did/didn't do X", taking personal responsibility, "I chose", "that was on me", "I let it slip"
- neutral: factual statement, question, context without clear responsibility signal, or ambiguous phrasing where the blame direction is unclear

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
- intent is memory_query                         → none
- checkin with no notable signals                → none

CHECKLIST CONTENT RULES:
- wins: message contains a win, success, accomplishment, something that went well
- honest: message contains an honest admission, something that went wrong, a miss, a struggle
- plan: message contains a commitment, plan for tomorrow, implementation intention
- identity: message references who they are, who they're becoming, values, identity statement

Return ONLY the JSON object. No explanation. No markdown.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_message, session_context = {} } = req.body;

    if (!user_message) {
      return res.status(400).json({ error: 'user_message is required' });
    }

    // Build a compact context string so the classifier can pick up on tone signals
    const contextHint = session_context.current_stage
      ? `[Session stage: ${session_context.current_stage}]`
      : '';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        {
          role: 'user',
          content: `${contextHint}\n\nUser message: "${user_message}"`,
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('classify-intent error:', err);
    return res.status(500).json({ error: 'Classification failed' });
  }
}