/**
 * api/extract-goal-commitments.js
 *
 * Takes a free-text commitment string and a list of active goals, uses GPT-4o-mini
 * to extract which goal IDs (if any) each piece of the commitment maps to, and
 * writes the results to goal_commitment_log.
 *
 * POST { user_id, session_id, commitment_text, goals: [{ id, title, category }] }
 *
 * Returns:
 *   { goal_commitments: [{ goal_id: string | null, commitment_fragment: string, confidence: "high"|"medium"|"low" }] }
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, session_id, commitment_text, goals, client_local_date } = req.body || {};
  if (!user_id || !commitment_text) {
    return res.status(400).json({ error: 'user_id and commitment_text are required' });
  }

  const goalList = Array.isArray(goals) ? goals : [];
  const todayDate = client_local_date || todayStr();

  try {
    let items = [];

    if (goalList.length > 0) {
      const extraction = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You extract goal links from a commitment string. Split the commitment into individual commitments if multiple are present (e.g. "go to gym and work on app" → two items). For each, match to the most relevant goal_id from the goals list, or null if none fit clearly.
Return ONLY valid JSON: { "items": [{ "goal_id": "uuid or null", "text": "commitment fragment", "confidence": "high|medium|low" }] }
Only link when genuinely relevant. Do not force links. Multiple items can have the same goal_id. goal_id must be exactly from the provided list or null.`,
          },
          {
            role: 'user',
            content: JSON.stringify({ commitment: commitment_text, goals: goalList }),
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 300,
      });

      try {
        const extracted = JSON.parse(extraction.choices[0].message.content);
        items = Array.isArray(extracted.items) ? extracted.items : [];
      } catch (_e) {
        items = [];
      }
    }

    // Write to goal_commitment_log
    const goalIds = new Set(goalList.map((g) => g.id));
    const insertRows = [];

    for (const item of items) {
      const goalId =
        item.goal_id && goalIds.has(item.goal_id) ? item.goal_id : null;
      insertRows.push({
        user_id,
        session_id: session_id || null,
        goal_id: goalId,
        commitment_text: item.text || commitment_text,
        date: todayDate,
        kept: null,
      });
    }

    // If no items extracted, log one unlinked entry
    if (insertRows.length === 0) {
      insertRows.push({
        user_id,
        session_id: session_id || null,
        goal_id: null,
        commitment_text,
        date: todayDate,
        kept: null,
      });
    }

    await supabase.from('goal_commitment_log').insert(insertRows);

    const goal_commitments = insertRows.map((row, i) => ({
      goal_id: row.goal_id,
      commitment_fragment: row.commitment_text,
      confidence: items[i]?.confidence || 'low',
    }));

    return res.status(200).json({ goal_commitments });
  } catch (err) {
    console.error('extract-goal-commitments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
