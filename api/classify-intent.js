/**
 * api/classify-intent.js
 *
 * Fast intent classifier — runs on every incoming message before the main
 * reflection-coach response is generated.  Uses gpt-4o-mini with low
 * max_tokens so it completes in ~300–600 ms.
 *
 * Returns a JSON object describing:
 *   intent, energy_level, accountability_signal, emotional_state,
 *   depth_opportunity, checklist_content, suggested_exercise
 *
 * Exercise routing rules (encoded in the shared classifier prompt):
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
 *
 * Classifier logic lives in src/lib/classifier.js (single source of truth).
 */

import { classifyIntent } from '../src/lib/classifier.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_message, session_context = {} } = req.body;

    if (!user_message) {
      return res.status(400).json({ error: 'user_message is required' });
    }

    const result = await classifyIntent(user_message, session_context);
    return res.status(200).json(result);
  } catch (err) {
    console.error('classify-intent error:', err);
    return res.status(500).json({ error: 'Classification failed' });
  }
}