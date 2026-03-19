/**
 * scripts/grade-trait-detection.js
 *
 * Uses GPT-4o to evaluate whether the coaching AI detected each hidden trait
 * that was secretly assigned to the fake persona during a simulation run.
 *
 * Exports:
 *   gradeTraitDetection({ assignedTraits, conversationHistory, personaName })
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GRADER_SYSTEM_PROMPT = `You are an expert psychological coach evaluator. You have been given a coaching conversation and a hidden trait the user was secretly expressing. Your job is to evaluate whether the coach detected and responded to this trait. Be honest and specific — look for moments where the coach could have probed deeper but didn't, and moments where they showed genuine insight. Do not give credit for generic coaching responses that happen to touch on the topic by accident.`;

/**
 * Format conversation history into a numbered transcript.
 *
 * @param {Array<{turn: number, coach: string, user: string, date?: string}>} history
 * @returns {string}
 */
function formatTranscript(history) {
  return history
    .map((entry) => {
      const prefix = entry.date ? `[${entry.date}] ` : '';
      const lines = [];
      if (entry.coach) lines.push(`${prefix}Turn ${entry.turn} — Coach: ${entry.coach}`);
      if (entry.user) lines.push(`${prefix}Turn ${entry.turn} — User: ${entry.user}`);
      return lines.join('\n');
    })
    .join('\n');
}

/**
 * Grade a single trait against the full conversation.
 *
 * @param {object} trait - Full trait object from HIDDEN_TRAITS
 * @param {string} transcript - Formatted numbered conversation transcript
 * @returns {Promise<object>} Per-trait grading result
 */
async function gradeSingleTrait(trait, transcript) {
  const userPrompt = `HIDDEN TRAIT BEING EVALUATED:
ID: ${trait.id}
Label: ${trait.label}
Archetype: ${trait.archetype}
Backstory: ${trait.backstory}

Surface behaviors the user was instructed to express:
${trait.surface_behaviors.map((b, i) => `${i + 1}. ${b}`).join('\n')}

What a great coach should notice:
${trait.coach_should_notice}

Concrete phrases/framings in the COACH's messages that count as genuine detection:
${trait.detection_signals.map((s) => `- ${s}`).join('\n')}

Things that sound like detection but are NOT (generic coaching responses):
${trait.false_positive_signals.map((s) => `- ${s}`).join('\n')}

---

FULL CONVERSATION TRANSCRIPT:
${transcript}

---

EVALUATION INSTRUCTIONS:
1. Did the coach detect and engage with this specific trait? Score 0-10.
   - 0-2: No detection at all, or only false positives
   - 3-4: Partial awareness — coach touched the area but didn't name or probe the pattern
   - 5-6: Clear detection — coach asked at least one good question that directly engages the trait
   - 7-8: Strong detection — coach named the pattern, probed it, and returned to it
   - 9-10: Exceptional — coach cracked the trait open, named it precisely, and created a real moment of insight
2. What turn number did detection first occur (if ever)? null if never.
3. Quote the specific coach message(s) that count as detection (if any).
4. List up to 3 specific moments the coach missed an opportunity to probe this trait (cite turn numbers).
5. Write a brief reasoning paragraph (2-4 sentences).

Return JSON only with this exact structure:
{
  "detected": true or false,
  "detection_score": 0-10,
  "first_detected_turn": number or null,
  "coach_evidence": "Turn N: \\"exact quote or paraphrase\\"" or null,
  "missed_signals": ["Turn N: description", ...],
  "grader_reasoning": "2-4 sentence paragraph"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: GRADER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const score = parsed.detection_score ?? 0;
    return {
      id: trait.id,
      label: trait.label,
      detected: parsed.detected ?? (score >= 5),
      detection_score: score,
      first_detected_turn: parsed.first_detected_turn ?? null,
      coach_evidence: parsed.coach_evidence ?? null,
      missed_signals: parsed.missed_signals ?? [],
      grader_reasoning: parsed.grader_reasoning ?? '',
    };
  } catch (err) {
    return {
      id: trait.id,
      label: trait.label,
      detected: false,
      detection_score: 0,
      first_detected_turn: null,
      coach_evidence: null,
      missed_signals: [],
      grader_reasoning: `Grading failed: ${err.message}`,
    };
  }
}

/**
 * Map an overall detection rate to a letter grade.
 *
 * @param {number} rate - 0.0 to 1.0
 * @returns {string} 'A', 'B', 'C', 'D', or 'F'
 */
function rateToGrade(rate) {
  if (rate > 0.8) return 'A';
  if (rate > 0.65) return 'B';
  if (rate > 0.5) return 'C';
  if (rate > 0.35) return 'D';
  return 'F';
}

/**
 * Grade the coaching AI's detection of all assigned hidden traits.
 *
 * @param {object} params
 * @param {Array<object>} params.assignedTraits     - Full trait objects assigned for this run
 * @param {Array<object>} params.conversationHistory - Flat array of {turn, coach, user, date?} from all sessions
 * @param {string}        params.personaName         - Name of the persona (for context)
 * @returns {Promise<object>} Full detection grading result
 */
export async function gradeTraitDetection({ assignedTraits, conversationHistory, personaName }) {
  if (!assignedTraits || assignedTraits.length === 0) {
    return {
      assigned_traits: [],
      overall_detection_rate: null,
      detection_grade: null,
      summary: 'No traits were assigned for this run.',
    };
  }

  const transcript = formatTranscript(conversationHistory);

  // Grade each trait (sequentially to avoid hammering rate limits)
  const gradedTraits = [];
  for (const trait of assignedTraits) {
    const result = await gradeSingleTrait(trait, transcript);
    gradedTraits.push(result);
  }

  // Compute overall detection rate
  const overallDetectionRate =
    gradedTraits.reduce((sum, t) => sum + t.detection_score / 10, 0) / gradedTraits.length;

  const grade = rateToGrade(overallDetectionRate);

  // Build summary via GPT-4o
  let summary = '';
  try {
    const summaryPrompt = `You evaluated a coaching AI's ability to detect ${gradedTraits.length} hidden psychological trait(s) in a user named ${personaName}.\n\nResults:\n${gradedTraits.map((t) => `- ${t.label}: ${t.detection_score}/10 — ${t.grader_reasoning}`).join('\n')}\n\nWrite a 2-3 sentence overall summary of the coaching AI's performance. Be specific about what it caught and what it missed. Do not use filler praise.`;

    const summaryResp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: GRADER_SYSTEM_PROMPT },
        { role: 'user', content: summaryPrompt },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });
    summary = summaryResp.choices[0].message.content.trim();
  } catch {
    summary = gradedTraits
      .map((t) => `${t.label}: ${t.detection_score}/10`)
      .join('; ');
  }

  return {
    assigned_traits: gradedTraits,
    overall_detection_rate: Math.round(overallDetectionRate * 100) / 100,
    detection_grade: grade,
    summary,
  };
}
