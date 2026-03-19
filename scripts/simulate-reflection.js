/**
 * scripts/simulate-reflection.js
 *
 * Main CLI runner for the reflection simulator.
 *
 * Usage:
 *   node --env-file=.env.simulation.local scripts/simulate-reflection.js \
 *     --days 30 \
 *     --start-date 2025-12-01 \
 *     --persona ambitious_but_inconsistent
 *
 * Calls api/reflection-coach.js directly as a function (no HTTP server needed).
 * Simulates a full coaching session per day, scoring each coach message with GPT-4o-mini.
 * Writes simulation-report.json to the scripts/ folder on completion.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

import handler from '../api/reflection-coach.js';
import { PERSONAS, DEFAULT_PERSONA } from './personas.js';
import { generateUserResponse, scoreCoachMessage } from './generate-user-response.js';

// ── Resolve paths ──────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORT_PATH = join(__dirname, 'simulation-report.json');

// ── Parse CLI args ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    days: 30,
    startDate: null,
    persona: DEFAULT_PERSONA,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) result.days = parseInt(args[++i], 10);
    else if (args[i] === '--start-date' && args[i + 1]) result.startDate = args[++i];
    else if (args[i] === '--persona' && args[i + 1]) result.persona = args[++i];
  }

  // Default start date: 30 days ago
  if (!result.startDate) {
    const d = new Date();
    d.setDate(d.getDate() - result.days);
    result.startDate = d.toISOString().slice(0, 10);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(result.startDate)) {
    console.error(`❌  Invalid --start-date "${result.startDate}" — expected YYYY-MM-DD`);
    process.exit(1);
  }

  return result;
}

// ── Date utilities ─────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format "${dateStr}" — expected YYYY-MM-DD`);
  }
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Call the coach handler directly ───────────────────────────────────────────
async function callCoach(body) {
  return new Promise((resolve) => {
    const req = { method: 'POST', body };
    const res = {
      status: (code) => ({ json: (data) => resolve({ code, ...data }) }),
      json: (data) => resolve({ code: 200, ...data }),
    };
    handler(req, res);
  });
}

// ── Supabase setup ─────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
    process.exit(1);
  }
  return createClient(url, key);
}

// ── Create a reflection_sessions row for the simulated date ───────────────────
async function createSessionRow(supabase, userId, simulatedDate) {
  const sessionId = randomUUID();
  const { error } = await supabase.from('reflection_sessions').insert({
    id: sessionId,
    user_id: userId,
    date: simulatedDate,
    current_stage: 'wins',
    is_complete: false,
    checklist: { wins: false, honest: false, plan: false, identity: false },
    exercises_run: [],
    consecutive_excuses: 0,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.warn(`  ⚠️  Could not create session row: ${error.message}`);
  }
  return sessionId;
}

// ── Terminal output helpers ────────────────────────────────────────────────────
function separator(day, dateStr) {
  const line = `━━━ DAY ${day} — ${dateStr} `;
  console.log('\n' + line + '━'.repeat(Math.max(0, 50 - line.length)));
}

function printCoach(msg) {
  console.log(`🤖  ${msg}`);
}

function printUser(msg) {
  console.log(`👤  ${msg}`);
}

function printQuality(quality) {
  if (!quality) return;
  const flagStr = quality.flags.length ? ` | ${quality.flags.join(', ')}` : '';
  console.log(`    ↳ Quality: ${quality.score}/5${flagStr}`);
}

function printSummary({ completed, stage, exercises, turns }) {
  const icon = completed ? '✅' : '⚠️ ';
  const exStr = exercises.length ? exercises.join(', ') : 'none';
  console.log(`${icon}  ${completed ? 'Complete' : 'Incomplete'} | Stage: ${stage} | Exercises: ${exStr} | Turns: ${turns}`);
}

// ── Main simulation ────────────────────────────────────────────────────────────
async function main() {
  const { days, startDate, persona: personaKey } = parseArgs();

  const persona = PERSONAS[personaKey];
  if (!persona) {
    console.error(`❌  Unknown persona "${personaKey}". Available: ${Object.keys(PERSONAS).join(', ')}`);
    process.exit(1);
  }

  const userId = process.env.SIM_USER_ID;
  if (!userId) {
    console.error('❌  SIM_USER_ID not set in environment');
    process.exit(1);
  }

  const supabase = getSupabase();

  console.log(`\n🚀  Starting simulation`);
  console.log(`    Persona:    ${personaKey} (${persona.name})`);
  console.log(`    Days:       ${days}`);
  console.log(`    Start date: ${startDate}`);
  console.log(`    User ID:    ${userId}\n`);

  // ── Report state ──
  const report = {
    meta: {
      persona: personaKey,
      start_date: startDate,
      days_simulated: days,
      user_id: userId,
      run_at: new Date().toISOString(),
    },
    summary: {
      total_turns: 0,
      avg_quality_score: 0,
      sessions_completed: 0,
      sessions_incomplete: 0,
      flags_by_type: {},
    },
    sessions: [],
    flagged_for_review: [],
  };

  let totalQualityScores = [];

  // ── Graceful interrupt handler — write partial report ──
  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
    console.log('\n\n⚠️  Interrupted — writing partial report...');
    finalizeReport(report, totalQualityScores);
    process.exit(0);
  });

  // ── Day loop ──────────────────────────────────────────────────────────────
  for (let day = 1; day <= days; day++) {
    if (interrupted) break;

    const simulatedDate = addDays(startDate, day - 1);

    // Pick mood for the day from persona's distribution
    const moods = persona.tendencies.mood_distribution;
    const mood = moods[(day - 1) % moods.length];

    separator(day, simulatedDate);

    // Create session row
    const sessionId = await createSessionRow(supabase, userId, simulatedDate);

    // Per-session state
    let history = [];
    let sessionState = {
      current_stage: 'wins',
      checklist: { wins: false, honest: false, plan: false, identity: false },
      tomorrow_commitment: null,
      exercises_run: [],
      consecutive_excuses: 0,
      is_complete: false,
    };

    // Track what the persona has shared this session (for realistic response gen)
    const sessionContext = { sharedWins: null, sharedMisses: null, sharedTomorrow: null };

    const sessionRecord = {
      date: simulatedDate,
      session_id: sessionId,
      completed: false,
      turns: 0,
      avg_quality: null,
      exercises_run: [],
      checklist: { wins: false, honest: false, plan: false, identity: false },
      conversation: [],
    };

    const sessionQualityScores = [];
    const MAX_TURNS = 16;
    let turn = 0;

    // ── INIT turn ──────────────────────────────────────────────────────────
    const initResult = await callCoach({
      user_id: userId,
      session_id: sessionId,
      session_state: sessionState,
      history: [],
      user_message: '__INIT__',
      context: { client_local_date: simulatedDate },
    });

    const initCoachMsg = initResult.assistant_message || '';
    printCoach(initCoachMsg);

    // Update session state from INIT
    if (initResult.stage_advance && initResult.new_stage) {
      sessionState.current_stage = initResult.new_stage;
    }
    if (initResult.checklist_updates) {
      sessionState.checklist = { ...sessionState.checklist, ...initResult.checklist_updates };
    }
    if (initResult.exercise_run && initResult.exercise_run !== 'none') {
      sessionState.exercises_run = [...sessionState.exercises_run, initResult.exercise_run];
    }
    if (typeof initResult.consecutive_excuses === 'number') {
      sessionState.consecutive_excuses = initResult.consecutive_excuses;
    }
    if (initResult.is_session_complete) {
      sessionState.is_complete = true;
    }

    history.push({ role: 'assistant', content: initCoachMsg });

    sessionRecord.conversation.push({
      turn: 0,
      coach: initCoachMsg,
      user: null,
      quality: null,
    });

    // ── Conversation loop ──────────────────────────────────────────────────
    while (!sessionState.is_complete && turn < MAX_TURNS) {
      turn++;

      // Generate user response (history always ends with the latest coach message)
      const userMsg = await generateUserResponse({
        persona,
        coachMessage: history[history.length - 1]?.content ?? '',
        currentStage: sessionState.current_stage,
        history,
        simulatedDate,
        mood,
        sessionContext,
      });

      printUser(userMsg);

      // Update session context so future responses are more coherent
      if (sessionState.current_stage === 'wins') sessionContext.sharedWins = userMsg;
      if (sessionState.current_stage === 'honest') sessionContext.sharedMisses = userMsg;
      if (sessionState.current_stage === 'tomorrow') sessionContext.sharedTomorrow = userMsg;

      history.push({ role: 'user', content: userMsg });

      // Call the coach
      const result = await callCoach({
        user_id: userId,
        session_id: sessionId,
        session_state: sessionState,
        history,
        user_message: userMsg,
        context: { client_local_date: simulatedDate },
      });

      const coachMsg = result.assistant_message || '';
      const prevUserMsg = userMsg;

      // Update session state
      if (result.stage_advance && result.new_stage) {
        sessionState.current_stage = result.new_stage;
      }
      if (result.checklist_updates) {
        sessionState.checklist = { ...sessionState.checklist, ...result.checklist_updates };
      }
      if (result.extracted_data?.tomorrow_commitment) {
        sessionState.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
      }
      if (result.exercise_run && result.exercise_run !== 'none') {
        if (!sessionState.exercises_run.includes(result.exercise_run)) {
          sessionState.exercises_run = [...sessionState.exercises_run, result.exercise_run];
        }
      }
      if (typeof result.consecutive_excuses === 'number') {
        sessionState.consecutive_excuses = result.consecutive_excuses;
      }
      if (result.is_session_complete) {
        sessionState.is_complete = true;
      }

      history.push({ role: 'assistant', content: coachMsg });

      printCoach(coachMsg);

      // Score the coach message
      const quality = await scoreCoachMessage({
        persona,
        userProfile: persona.profile,
        currentStage: sessionState.current_stage,
        turnNumber: turn,
        previousUserMessage: prevUserMsg,
        coachMessage: coachMsg,
      });

      printQuality(quality);

      sessionQualityScores.push(quality.score);
      totalQualityScores.push(quality.score);

      // Track flags globally
      for (const flag of quality.flags) {
        report.summary.flags_by_type[flag] = (report.summary.flags_by_type[flag] || 0) + 1;
      }

      const conversationEntry = {
        turn,
        coach: coachMsg,
        user: userMsg,
        quality,
      };
      sessionRecord.conversation.push(conversationEntry);
      report.summary.total_turns++;

      // Flag low quality messages for review
      if (quality.score <= 2 || quality.flags.length > 0) {
        report.flagged_for_review.push({
          date: simulatedDate,
          turn,
          coach_message: coachMsg,
          user_message_before: prevUserMsg,
          session_stage: sessionState.current_stage,
          quality_score: quality.score,
          flags: quality.flags,
          reason: quality.reason,
          session_id: sessionId,
        });
      }

      if (sessionState.is_complete) break;
    }

    // Finalize session record
    sessionRecord.completed = sessionState.is_complete;
    sessionRecord.turns = turn;
    sessionRecord.exercises_run = sessionState.exercises_run;
    sessionRecord.checklist = sessionState.checklist;
    sessionRecord.avg_quality =
      sessionQualityScores.length > 0
        ? Math.round((sessionQualityScores.reduce((a, b) => a + b, 0) / sessionQualityScores.length) * 100) / 100
        : null;

    report.sessions.push(sessionRecord);

    if (sessionState.is_complete) {
      report.summary.sessions_completed++;
    } else {
      report.summary.sessions_incomplete++;
    }

    printSummary({
      completed: sessionState.is_complete,
      stage: sessionState.current_stage,
      exercises: sessionState.exercises_run,
      turns: turn,
    });

    // Small delay between days to avoid rate limiting
    if (day < days) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  finalizeReport(report, totalQualityScores);
  console.log(`\n✅  Simulation complete. Report saved to:\n    ${REPORT_PATH}\n`);
}

// ── Finalize and write report ──────────────────────────────────────────────────
function finalizeReport(report, totalQualityScores) {
  report.summary.avg_quality_score =
    totalQualityScores.length > 0
      ? Math.round((totalQualityScores.reduce((a, b) => a + b, 0) / totalQualityScores.length) * 100) / 100
      : 0;

  try {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    console.error('❌  Could not write report:', err.message);
  }
}

main().catch((err) => {
  console.error('❌  Simulation failed:', err);
  process.exit(1);
});
