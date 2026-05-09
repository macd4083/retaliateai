import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUserId } from '../src/lib/auth.js';

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

  const action = req.body?.action;
  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  if (action === 'create') {
    let authenticatedUserId;
    try {
      authenticatedUserId = await getAuthenticatedUserId(req);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }

    try {
      const { user_id, title, why_it_matters } = req.body;

      console.log('Received goal creation request:', { user_id, title });

      if (!authenticatedUserId || !title) {
        return res.status(400).json({ error: 'user_id and title are required' });
      }

      // Seed whys array from why_it_matters if provided (why_it_matters accepted for
      // backwards-compat with existing callers but is not stored as a separate column)
      const now = new Date().toISOString();
      const initialWhys = why_it_matters
        ? [{ text: why_it_matters, added_at: now, source: 'user_journal' }]
        : [];

      // Create the goal - matches your schema exactly
      const { data, error } = await supabase
        .from('goals')
        .insert({
          user_id: authenticatedUserId,
          title: title,
          whys: initialWhys,
          status: 'active',
          // target_date, created_at, updated_at, completed_at will be handled by database defaults
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });

        return res.status(500).json({
          error: 'Database error',
          message: error.message,
          details: error.details,
          hint: error.hint
        });
      }

      console.log('Goal created successfully:', data);
      return res.status(200).json({ goal: data });
    } catch (error) {
      console.error('Unexpected error creating goal:', error);
      return res.status(500).json({
        error: 'Failed to create goal',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  if (action === 'extract-commitments') {
    const { user_id, session_id, commitment_text, goals, client_local_date, commitment_type } = req.body || {};
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

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const goalId =
          item.goal_id && goalIds.has(item.goal_id) ? item.goal_id : null;
        const rowCommitmentType = item.commitment_type || commitment_type || null;
        insertRows.push({
          user_id,
          session_id: session_id || null,
          goal_id: goalId,
          commitment_text: item.text || commitment_text,
          date: todayDate,
          kept: null,
          fragment_index: i,
          commitment_type: rowCommitmentType,
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
          fragment_index: 0,
          commitment_type: commitment_type || null,
        });
      }

      const { error: insertError } = await supabase.from('goal_commitment_log').insert(insertRows);
      if (insertError) {
        console.error('extract-goal-commitments insert error:', insertError.message);
        // Still return the extracted items so callers know what was found, but surface the error
        return res.status(200).json({
          goal_commitments: insertRows.map((row, i) => ({
            goal_id: row.goal_id,
            commitment_fragment: row.commitment_text,
            confidence: items[i]?.confidence || 'low',
          })), insert_error: insertError.message
        });
      }

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

  return res.status(400).json({ error: 'Invalid action' });
}
