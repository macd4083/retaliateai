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
import commitmentStatsHandler from '../api/commitment-stats.js';
import generatePatternNarrativeHandler from '../api/generate-pattern-narrative.js';
import { PERSONAS, DEFAULT_PERSONA } from './personas.js';
import { generateUserResponse, scoreCoachMessage } from './generate-user-response.js';
import { drawTraits } from './hidden-traits.js';
import { gradeTraitDetection } from './grade-trait-detection.js';

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
    clean: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) result.days = parseInt(args[++i], 10);
    else if (args[i] === '--start-date' && args[i + 1]) result.startDate = args[++i];
    else if (args[i] === '--persona' && args[i + 1]) result.persona = args[++i];
    else if (args[i] === '--clean') result.clean = true;
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

// ── Call any handler directly (generic helper) ────────────────────────────────
function callHandler(handlerFn, body) {
  return new Promise((resolve) => {
    const req = { method: 'POST', body };
    const res = {
      status: (code) => ({ json: (data) => resolve({ code, ...data }) }),
      json: (data) => resolve({ code: 200, ...data }),
    };
    handlerFn(req, res);
  });
}

// ── Call the coach handler directly ───────────────────────────────────────────
async function callCoach(body) {
  return callHandler(handler, body);
}

// ── Validate backend state after a session completes ─────────────────────────
/**
 * Calls commitment-stats, queries reflection_patterns, and optionally calls
 * generate-pattern-narrative to verify real data landed correctly.
 *
 * @param {object} supabase   - Supabase client
 * @param {string} userId     - The simulated user ID
 * @param {string} simulatedDate - The date of the completed session (YYYY-MM-DD)
 * @returns {Promise<object>} - backend_state object for the session record
 */
async function validateBackend(supabase, userId, simulatedDate) {
  const backendState = {
    follow_through_7day: null,
    trajectory: null,
    patterns_accumulated: [],
    narrative_sample: null,
    goals_snapshot: [],
  };

  // 1. Commitment stats
  try {
    const stats = await callHandler(commitmentStatsHandler, { user_id: userId });
    if (stats.followThrough7) {
      backendState.follow_through_7day = stats.followThrough7;
      backendState.trajectory = stats.trajectory ?? null;
      console.log(`    📊  Follow-through (7d): ${stats.followThrough7.kept}/${stats.followThrough7.total} kept | Trajectory: ${stats.trajectory ?? 'n/a'}`);
    }
  } catch (err) {
    console.warn(`    ⚠️  commitment-stats failed: ${err.message}`);
  }

  // 2. Accumulated reflection patterns
  try {
    const { data: patterns } = await supabase
      .from('reflection_patterns')
      .select('label, occurrence_count, pattern_type')
      .eq('user_id', userId)
      .order('occurrence_count', { ascending: false })
      .limit(10);

    if (patterns && patterns.length > 0) {
      backendState.patterns_accumulated = patterns.map((p) => ({
        label: p.label,
        occurrences: p.occurrence_count,
        type: p.pattern_type,
      }));
      const patternStr = patterns
        .map((p) => `${p.label}(${p.occurrence_count})`)
        .join(', ');
      console.log(`    🔁  Patterns: ${patternStr}`);

      // 3. Generate narrative if enough signal exists
      const qualifyingPatterns = patterns.filter((p) => p.occurrence_count >= 2);
      if (qualifyingPatterns.length >= 2) {
        try {
          const narrativeResult = await callHandler(generatePatternNarrativeHandler, { user_id: userId });
          if (narrativeResult.narratives && narrativeResult.narratives.length > 0) {
            const first = narrativeResult.narratives[0];
            const preview = first.narrative ?? '';
            backendState.narrative_sample = preview || null;
            const display = preview.length > 120 ? `${preview.slice(0, 120)}...` : preview;
            console.log(`    💬  Narrative (${first.label}): "${display}"`);
          }
        } catch (err) {
          console.warn(`    ⚠️  generate-pattern-narrative failed: ${err.message}`);
        }
      }
    } else {
      console.log(`    🔁  Patterns: none accumulated yet`);
    }
  } catch (err) {
    console.warn(`    ⚠️  reflection_patterns query failed: ${err.message}`);
  }

  // 3. Goals snapshot
  try {
    const { data: goals } = await supabase
      .from('goals')
      .select('title, category, why_it_matters')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (goals && goals.length > 0) {
      backendState.goals_snapshot = goals.map((g) => ({
        title: g.title,
        category: g.category,
        why_it_matters: g.why_it_matters,
      }));
      console.log(`    🎯  Goals (${goals.length} active):`);
      for (const g of goals) {
        const why = g.why_it_matters
          ? `"${g.why_it_matters.length > 80 ? `${g.why_it_matters.slice(0, 80)}...` : g.why_it_matters}"`
          : 'not set';
        console.log(`        "${g.title}" [${g.category ?? 'uncategorized'}] — why: ${why}`);
      }
    } else {
      console.log(`    🎯  Goals: none active`);
    }
  } catch (err) {
    console.warn(`    ⚠️  goals query failed: ${err.message}`);
  }

  return backendState;
}

// ── Fetch user profile snapshot and generated narratives ──────────────────────
/**
 * Queries user_profiles and calls generatePatternNarrativeHandler to capture
 * the current state of the user's profile and generated narratives for the report.
 *
 * @param {object} supabase - Supabase client
 * @param {string} userId   - The simulated user ID
 * @returns {Promise<{profile: object, narratives: Array}>}
 */
async function fetchProfileSnapshot(supabase, userId) {
  let profile = null;
  let narratives = [];

  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('identity_statement, big_goal, why, short_term_state, strengths, growth_areas')
      .eq('id', userId)
      .single();
    profile = data ?? null;
  } catch (err) {
    console.warn(`    ⚠️  user_profiles query failed: ${err.message}`);
  }

  try {
    const narrativeResult = await callHandler(generatePatternNarrativeHandler, { user_id: userId });
    narratives = narrativeResult.narratives ?? [];
  } catch (err) {
    console.warn(`    ⚠️  generate-pattern-narrative failed in profile snapshot: ${err.message}`);
  }

  return { profile, narratives };
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

// ── Clean user data — wipe all sim user rows before a fresh run ───────────────
async function cleanUserData(supabase, userId) {
  const tablesCleared = [];
  let rowsDeleted = 0;

  // Get all session IDs for this user first
  const { data: sessions } = await supabase
    .from('reflection_sessions')
    .select('id')
    .eq('user_id', userId);

  const sessionIds = (sessions ?? []).map((s) => s.id);

  // Delete reflection_messages joined through sessions
  if (sessionIds.length > 0) {
    const { data: deletedMsgs, error: msgErr } = await supabase
      .from('reflection_messages')
      .delete()
      .in('session_id', sessionIds)
      .select('id');
    if (!msgErr) {
      const count = (deletedMsgs ?? []).length;
      rowsDeleted += count;
      tablesCleared.push({ table: 'reflection_messages', rows: count });
      console.log(`    🗑️  Cleared reflection_messages (${count} rows)`);
    }
  } else {
    tablesCleared.push({ table: 'reflection_messages', rows: 0 });
    console.log(`    🗑️  Cleared reflection_messages (0 rows)`);
  }

  // Delete reflection_sessions
  {
    const { data: deletedSessions, error: sessErr } = await supabase
      .from('reflection_sessions')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (!sessErr) {
      const count = (deletedSessions ?? []).length;
      rowsDeleted += count;
      tablesCleared.push({ table: 'reflection_sessions', rows: count });
      console.log(`    🗑️  Cleared reflection_sessions (${count} rows)`);
    }
  }

  // Delete reflection_patterns
  {
    const { data: deletedPatterns, error: patErr } = await supabase
      .from('reflection_patterns')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (!patErr) {
      const count = (deletedPatterns ?? []).length;
      rowsDeleted += count;
      tablesCleared.push({ table: 'reflection_patterns', rows: count });
      console.log(`    🗑️  Cleared reflection_patterns (${count} rows)`);
    }
  }

  // Delete follow_up_queue
  {
    const { data: deletedQueue, error: queueErr } = await supabase
      .from('follow_up_queue')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (!queueErr) {
      const count = (deletedQueue ?? []).length;
      rowsDeleted += count;
      tablesCleared.push({ table: 'follow_up_queue', rows: count });
      console.log(`    🗑️  Cleared follow_up_queue (${count} rows)`);
    }
  }

  // Delete growth_markers
  {
    const { data: deletedMarkers, error: markerErr } = await supabase
      .from('growth_markers')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (!markerErr) {
      const count = (deletedMarkers ?? []).length;
      rowsDeleted += count;
      tablesCleared.push({ table: 'growth_markers', rows: count });
      console.log(`    🗑️  Cleared growth_markers (${count} rows)`);
    }
  }

  // Delete goals
  {
    const { data: deletedGoals, error: goalsErr } = await supabase
      .from('goals')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (!goalsErr) {
      const count = (deletedGoals ?? []).length;
      rowsDeleted += count;
      tablesCleared.push({ table: 'goals', rows: count });
      console.log(`    🗑️  Cleared goals (${count} rows)`);
    }
  }

  return { tablesCleared, rowsDeleted };
}

// ── Seed user profile — reset to persona definition for a clean baseline ──────
async function seedUserProfile(supabase, userId, persona) {
  const { error } = await supabase.from('user_profiles').upsert(
    {
      id: userId,
      display_name: persona.profile.display_name,
      big_goal: persona.profile.big_goal,
      why: persona.profile.why,
      future_self: persona.profile.future_self,
      identity_statement: persona.profile.identity_statement,
      life_areas: persona.profile.life_areas,
      blockers: persona.profile.blockers,
      short_term_state: null,
      long_term_patterns: [],
      strengths: [],
      growth_areas: [],
      exercises_explained: [],
      values: [],
      profile_updated_at: null,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.warn(`  ⚠️  Could not seed user profile: ${error.message}`);
  } else {
    console.log(`    🌱  Profile seeded for persona: ${persona.name}`);
  }

  // Insert goals from persona definition
  if (persona.profile?.goals && persona.profile.goals.length > 0) {
    const goalRows = persona.profile.goals.map((g) => ({
      user_id: userId,
      title: g.title,
      why_it_matters: g.why_it_matters || null,
      category: g.category || null,
      status: 'active',
    }));
    const { error: goalsErr } = await supabase.from('goals').insert(goalRows);
    if (goalsErr) {
      console.warn(`  ⚠️  Could not seed goals: ${goalsErr.message}`);
    } else {
      console.log(`    🎯  ${goalRows.length} goal(s) seeded`);
    }
  }
}

// ── Main simulation ────────────────────────────────────────────────────────────
async function main() {
  const { days, startDate, persona: personaKey, clean } = parseArgs();

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

  // ── Draw hidden traits from the persona's pool ────────────────────────────
  const traitPool = persona.hiddenTraitPool ?? [];
  const assignedTraits = drawTraits(traitPool, 2);

  console.log(`🧠  Hidden traits assigned:`);
  assignedTraits.forEach((t, i) => {
    console.log(`    ${i + 1}. ${t.label} — ${t.archetype}`);
  });
  console.log('');

  // ── Report state ──
  const report = {
    meta: {
      persona: personaKey,
      start_date: startDate,
      days_simulated: days,
      user_id: userId,
      run_at: new Date().toISOString(),
      assigned_traits: assignedTraits.map((t) => ({ id: t.id, label: t.label })),
      clean: clean,
      pre_run_profile_snapshot: null,
      clean_result: null,
    },
    summary: {
      total_turns: 0,
      avg_quality_score: 0,
      sessions_completed: 0,
      sessions_incomplete: 0,
      flags_by_type: {},
    },
    backend_summary: {
      final_follow_through_7day: null,
      final_trajectory: null,
      all_patterns: [],
      narrative_produced: false,
      narrative_sample: null,
      user_profile_snapshot: null,
      generated_narratives: [],
    },
    sessions: [],
    flagged_for_review: [],
  };

  let totalQualityScores = [];

  // ── Cross-session state — carries forward across days ─────────────────────
  const crossSessionState = {
    yesterdayCommitment: null,
  };

  // ── Graceful interrupt handler — write partial report ──
  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
    console.log('\n\n⚠️  Interrupted — writing partial report...');
    finalizeReport(report, totalQualityScores);
    process.exit(0);
  });

  // ── --clean: snapshot, wipe, and seed before the day loop ─────────────────
  if (clean) {
    console.log('\n🧹  --clean flag set. Wiping previous sim data...');

    // 1. Snapshot existing profile
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    report.meta.pre_run_profile_snapshot = existingProfile ?? null;

    // 2. Wipe data
    const cleanResult = await cleanUserData(supabase, userId);
    report.meta.clean_result = cleanResult;

    // 3. Seed profile
    await seedUserProfile(supabase, userId, persona);

    console.log('✅  Clean complete. Starting fresh simulation.\n');
  }

  // ── Day loop ──────────────────────────────────────────────────────────────
  for (let day = 1; day <= days; day++) {
    if (interrupted) break;

    const simulatedDate = addDays(startDate, day - 1);

    // Pick mood for the day from persona's distribution
    const moods = persona.tendencies.mood_distribution;
    const mood = moods[(day - 1) % moods.length];

    // Draw today's daily event randomly from the persona's event bank
    const eventBank = persona.dailyEventBank ?? [];
    const dailyEvent = eventBank.length > 0
      ? eventBank[Math.floor(Math.random() * eventBank.length)]
      : null;

    separator(day, simulatedDate);
    if (dailyEvent) {
      console.log(`📅  Today's event: ${dailyEvent}`);
    }

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
      daily_event: dailyEvent,
      completed: false,
      turns: 0,
      avg_quality: null,
      exercises_run: [],
      checklist: { wins: false, honest: false, plan: false, identity: false },
      conversation: [],
      backend_state: null,
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
        dailyEvent,
        yesterdayCommitment: crossSessionState.yesterdayCommitment,
        assignedTraits,
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

      // Guard: skip empty coach messages — don't push to history or score
      if (!coachMsg.trim()) {
        console.warn(`    ⚠️  Turn ${turn}: coach returned empty message — skipping turn`);
        turn--; // don't count this as a real turn
        continue;
      }

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

    // Update cross-session state for the next day
    crossSessionState.yesterdayCommitment = sessionState.tomorrow_commitment ?? null;

    // Run backend validation and store result
    console.log(`\n🔍  Backend validation:`);
    const backendState = await validateBackend(supabase, userId, simulatedDate);
    sessionRecord.backend_state = backendState;

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

  // ── Populate final backend_summary from last known state ──────────────────
  const lastSession = report.sessions[report.sessions.length - 1];
  if (lastSession?.backend_state) {
    const bs = lastSession.backend_state;
    report.backend_summary.final_follow_through_7day = bs.follow_through_7day;
    report.backend_summary.final_trajectory = bs.trajectory;
    report.backend_summary.narrative_produced = !!bs.narrative_sample;
    report.backend_summary.narrative_sample = bs.narrative_sample;
  }
  // Collect all patterns sorted by occurrence count (from last session with patterns)
  for (let i = report.sessions.length - 1; i >= 0; i--) {
    const patterns = report.sessions[i]?.backend_state?.patterns_accumulated;
    if (patterns && patterns.length > 0) {
      report.backend_summary.all_patterns = [...patterns].sort((a, b) => b.occurrences - a.occurrences);
      break;
    }
  }

  // ── Fetch final profile snapshot and generated narratives ─────────────────
  try {
    const { profile, narratives } = await fetchProfileSnapshot(supabase, userId);
    report.backend_summary.user_profile_snapshot = {
      identity_statement: profile?.identity_statement ?? null,
      big_goal: profile?.big_goal ?? null,
      why: profile?.why ?? null,
      short_term_state: profile?.short_term_state ?? null,
      strengths: profile?.strengths ?? [],
      growth_areas: profile?.growth_areas ?? [],
    };
    report.backend_summary.generated_narratives = narratives ?? [];
    console.log(`\n📋  Profile snapshot captured`);
    console.log(`💬  ${narratives.length} narratives generated`);
  } catch (err) {
    console.warn(`    ⚠️  fetchProfileSnapshot failed: ${err.message}`);
  }

  // ── Grade hidden trait detection ──────────────────────────────────────────
  console.log(`\n🎯  Grading hidden trait detection...`);
  try {
    // Build flat conversation history from all sessions with globally unique turn numbers
    let globalTurn = 0;
    const fullConversationHistory = [];
    for (const session of report.sessions) {
      for (const entry of session.conversation) {
        if (entry.coach || entry.user) {
          fullConversationHistory.push({
            turn: globalTurn++,
            coach: entry.coach || null,
            user: entry.user || null,
            date: session.date,
            session_id: session.session_id,
          });
        }
      }
    }

    const traitDetectionResult = await gradeTraitDetection({
      assignedTraits,
      conversationHistory: fullConversationHistory,
      personaName: persona.name,
    });

    report.trait_detection = traitDetectionResult;

    // Log results to terminal
    console.log(`\n🎯  Trait Detection Results:`);
    for (const t of traitDetectionResult.assigned_traits) {
      const detectedLabel =
        t.detection_score >= 7
          ? 'Detected ✅'
          : t.detection_score >= 4
            ? 'Partially detected ⚠️'
            : 'Not detected ❌';
      console.log(`    ${t.label}:  ${t.detection_score}/10 — ${detectedLabel}`);
      const firstDetected =
        t.first_detected_turn !== null ? `Turn ${t.first_detected_turn}` : 'never';
      console.log(`      First detected: ${firstDetected}`);
      const evidence = t.coach_evidence ? t.coach_evidence.slice(0, 80) : '(none)';
      console.log(`      Evidence: ${evidence}`);
    }
    const rate = traitDetectionResult.overall_detection_rate;
    console.log(
      `    Overall grade: ${traitDetectionResult.detection_grade} (${rate !== null && rate !== undefined ? (rate * 100).toFixed(0) : 'n/a'}% detection rate)`,
    );
    const summaryPreview = traitDetectionResult.summary
      ? traitDetectionResult.summary.slice(0, 150)
      : '';
    console.log(`    ${summaryPreview}`);
  } catch (err) {
    console.warn(`    ⚠️  Trait detection grading failed: ${err.message}`);
    report.trait_detection = null;
  }

  finalizeReport(report, totalQualityScores);
  console.log(`\n✅  Simulation complete. Report saved to:\n    ${REPORT_PATH}\n`);
  if (clean) {
    console.log(`✅  Clean run complete. Pre-run snapshot saved to report.meta.pre_run_profile_snapshot\n`);
  }
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
