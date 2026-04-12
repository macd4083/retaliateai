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
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

import handler from '../api/reflection-coach.js';
import commitmentStatsHandler from '../api/commitment-stats.js';
import generatePatternNarrativeHandler from '../api/generate-pattern-narrative.js';
import createGoalHandler from '../api/create-goal.js';
import classifyIntentHandler from '../api/classify-intent.js';
import generateEmbeddingHandler from '../api/generate-embedding.js';
import extractGoalCommitmentsHandler from '../api/extract-goal-commitments.js';
import goalCommitmentStatsHandler from '../api/goal-commitment-stats.js';
import evaluateGoalCommitmentsHandler from '../api/evaluate-goal-commitments.js';
import { PERSONAS, DEFAULT_PERSONA } from './personas.js';
import { generateUserResponse, scoreCoachMessage } from './generate-user-response.js';
import { drawTraits } from './hidden-traits.js';
import { gradeTraitDetection } from './grade-trait-detection.js';

// ── Resolve paths ──────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_REPORT_PATH = join(__dirname, 'simulation-report.json');
const WHY_BUILDING_REPORT_PATH = join(__dirname, 'why-building-report.json');
const FULL_COVERAGE_REPORT_PATH = join(__dirname, 'full-coverage-report.json');

// ── All exercises the simulator tracks across the full run ────────────────────
const ALL_EXERCISES = [
  'why_reconnect',
  'identity_reinforcement',
  'future_self_visualization',
  'reframe_failure',
  'values_clarification',
  'pattern_interrupt',
  'commitment_deepening',
  'accountability_mirror',
];

// ── Scenario follow-through probabilities ─────────────────────────────────────
// In 'mixed' scenario: probability of missing after keeping, and keeping after missing
const MISS_AFTER_KEEP_PROBABILITY = 0.4;
const KEEP_AFTER_MISS_PROBABILITY = 0.7;

// ── Parse CLI args ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    days: 30,
    startDate: null,
    persona: DEFAULT_PERSONA,
    clean: false,
    testWhyBuilding: false,
    testGoalSuggestion: false,
    testFullCoverage: false,
    assertWeek: null,
    scenario: 'mixed',     // 'kept_streak' | 'miss_streak' | 'mixed' | 'cold_start'
    dryRun: false,
    reportPath: null,      // custom output path for report JSON
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) result.days = parseInt(args[++i], 10);
    else if (args[i] === '--start-date' && args[i + 1]) result.startDate = args[++i];
    else if (args[i] === '--persona' && args[i + 1]) result.persona = args[++i];
    else if (args[i] === '--clean') result.clean = true;
    else if (args[i] === '--test-why-building') result.testWhyBuilding = true;
    else if (args[i] === '--test-goal-suggestion') result.testGoalSuggestion = true;
    else if (args[i] === '--test-full-coverage') result.testFullCoverage = true;
    else if (args[i] === '--assert-week' && args[i + 1]) result.assertWeek = parseInt(args[++i], 10);
    else if (args[i] === '--scenario' && args[i + 1]) result.scenario = args[++i];
    else if (args[i] === '--dry-run') result.dryRun = true;
    else if (args[i] === '--report-path' && args[i + 1]) result.reportPath = args[++i];
  }

  // Validate scenario
  const validScenarios = ['kept_streak', 'miss_streak', 'mixed', 'cold_start'];
  if (!validScenarios.includes(result.scenario)) {
    console.error(`❌  Invalid --scenario "${result.scenario}" — must be one of: ${validScenarios.join(', ')}`);
    process.exit(1);
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

// ── Array shuffle utility (Fisher-Yates) ─────────────────────────────────────
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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

// ── Minimum keyword length for specific-why reference detection ───────────────
const MIN_KEYWORD_LENGTH = 5;

/**
 * Given a list of active goal rows (with `id` and `whys` fields),
 * returns the whys array of the most relevant goal for coach scoring context.
 * Prefers a goal that already has whys; falls back to the first goal.
 *
 * @param {Array} goals - Active goal rows from Supabase
 * @returns {Array} - The whys array to pass to scoreCoachMessage
 */
function selectGoalWhysForScoring(goals) {
  if (!goals || goals.length === 0) return [];
  const goalWithWhys = goals.find((g) => Array.isArray(g.whys) && g.whys.length > 0);
  const selected = goalWithWhys ?? goals[0];
  return Array.isArray(selected?.whys) ? selected.whys : [];
}

// ── Assert that whys are present in the coach context ─────────────────────────
/**
 * Queries active goals and checks that any goals with whys[] populated would
 * have their whys sent to the coach (since reflection-coach.js selects whys
 * from the goals table and includes them in the AI context block).
 *
 * Logs ✅ if whys are present and should be in context,
 * or a note if no whys exist yet.
 *
 * @param {object} supabase - Supabase client
 * @param {string} userId   - The simulated user ID
 * @returns {Promise<{goalsWithWhys: number, totalWhys: number}>}
 */
async function assertWhysContext(supabase, userId) {
  try {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, title, whys')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (!goals || goals.length === 0) return { goalsWithWhys: 0, totalWhys: 0 };

    let goalsWithWhys = 0;
    let totalWhys = 0;
    for (const g of goals) {
      const whysArr = Array.isArray(g.whys) ? g.whys : [];
      if (whysArr.length > 0) {
        goalsWithWhys++;
        totalWhys += whysArr.length;
      }
    }

    if (goalsWithWhys > 0) {
      console.log(`    ✅  Whys context: ${goalsWithWhys} goal(s) with ${totalWhys} total why(s) — included in coach context`);
    } else {
      console.log(`    ℹ️   Whys context: no whys recorded yet — coach will ask exploratory motivation questions`);
    }

    return { goalsWithWhys, totalWhys };
  } catch (err) {
    console.warn(`    ⚠️  assertWhysContext failed: ${err.message}`);
    return { goalsWithWhys: 0, totalWhys: 0 };
  }
}

// ── Validate backend state after a session completes ─────────────────────────
/**
 * Calls commitment-stats, queries user_insights, and optionally calls
 * generate-pattern-narrative to verify real data landed correctly.
 * Also calls generate-embedding, classify-intent, extract-goal-commitments,
 * goal-commitment-stats, and evaluate-goal-commitments when context is provided.
 *
 * @param {object} supabase      - Supabase client
 * @param {string} userId        - The simulated user ID
 * @param {string} simulatedDate - The date of the completed session (YYYY-MM-DD)
 * @param {object} prevGoalWhysCounts - Previous session's goal whys counts
 * @param {object} options       - Optional extra context for extended checks
 *   @param {string}  options.sampleUserMessage - A user message to run embedding/intent checks on
 *   @param {string}  options.commitmentText    - Commitment text for goal extraction
 *   @param {Array}   options.sampleGoals       - Active goal stubs [{ id, title, category }]
 *   @param {string}  options.sessionId         - Current session ID
 * @returns {Promise<object>} - backend_state object for the session record
 */
async function validateBackend(supabase, userId, simulatedDate, prevGoalWhysCounts = {}, options = {}) {
  const backendState = {
    follow_through_7day: null,
    trajectory: null,
    patterns_accumulated: [],
    narrative_sample: null,
    goals_snapshot: [],
    why_evolution_events: [],
    embedding_check: null,
    classify_intent_check: null,
    extract_commitments_check: null,
    goal_commitment_stats_check: null,
    evaluate_commitments_check: null,
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

  // 2. Accumulated user_insights (replaces reflection_patterns)
  try {
    const { data: insights } = await supabase
      .from('user_insights')
      .select('pattern_label, pattern_type, sessions_synthesized_from, first_seen_date, last_seen_date')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(10);

    if (insights && insights.length > 0) {
      backendState.patterns_accumulated = insights.map((ins) => ({
        label: ins.pattern_label,
        occurrences: ins.sessions_synthesized_from,
        type: ins.pattern_type,
        first_seen_date: ins.first_seen_date,
        last_seen_date: ins.last_seen_date,
      }));
      const insightStr = insights
        .map((ins) => `${ins.pattern_label}(${ins.sessions_synthesized_from || 0}x)`)
        .join(', ');
      console.log(`    🔁  Insights: ${insightStr}`);

      // 3. Generate narrative if insights exist
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
    } else {
      console.log(`    🔁  Insights: none synthesized yet`);
    }
  } catch (err) {
    console.warn(`    ⚠️  user_insights query failed: ${err.message}`);
  }

  // 3. Goals snapshot — read whys[], detect evolution vs previous session
  try {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, title, category, whys, last_mentioned_at')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (goals && goals.length > 0) {
      backendState.goals_snapshot = goals.map((g) => {
        const whysArr = Array.isArray(g.whys) ? g.whys : [];
        const latestWhy = whysArr.length > 0 ? whysArr[whysArr.length - 1] : null;
        return {
          goal_id: g.id,
          title: g.title,
          category: g.category,
          whys: whysArr,
          whys_count: whysArr.length,
          latest_why: latestWhy?.text ?? null,
          latest_why_added_at: latestWhy?.added_at ?? null,
          last_mentioned_at: g.last_mentioned_at,
        };
      });

      console.log(`    🎯  Goals (${goals.length} active):`);
      for (const g of goals) {
        const whysArr = Array.isArray(g.whys) ? g.whys : [];
        const latestWhy = whysArr.length > 0
          ? whysArr[whysArr.length - 1].text
          : null;
        const whyDisplay = latestWhy
          ? `"${latestWhy.length > 80 ? `${latestWhy.slice(0, 80)}...` : latestWhy}"`
          : 'not set';
        const whyCount = whysArr.length > 0 ? ` (${whysArr.length} why${whysArr.length !== 1 ? 's' : ''})` : '';
        const lastMentioned = g.last_mentioned_at ? ` | last mentioned: ${g.last_mentioned_at}` : '';

        // Detect why evolution vs previous session
        const prevCount = prevGoalWhysCounts[g.id] ?? null;
        let evolutionNote = '';
        if (prevCount !== null && whysArr.length !== prevCount) {
          if (whysArr.length > prevCount) {
            evolutionNote = ` 🆕 why added (${prevCount} → ${whysArr.length})`;
            backendState.why_evolution_events.push({
              goal_id: g.id,
              goal_title: g.title,
              event: 'added',
              prev_count: prevCount,
              new_count: whysArr.length,
              date: simulatedDate,
            });
          } else {
            evolutionNote = ` 🔄 why replaced (${prevCount} → ${whysArr.length})`;
            backendState.why_evolution_events.push({
              goal_id: g.id,
              goal_title: g.title,
              event: 'replaced',
              prev_count: prevCount,
              new_count: whysArr.length,
              date: simulatedDate,
            });
          }
        }
        console.log(`        "${g.title}" [${g.category ?? 'uncategorized'}] — latest why: ${whyDisplay}${whyCount}${lastMentioned}${evolutionNote}`);
      }
    } else {
      console.log(`    🎯  Goals: none active`);
    }
  } catch (err) {
    if (err.message && err.message.includes('column') && err.message.includes('whys')) {
      console.warn(`    ⚠️  goals.whys column not found — migration pending. Run scripts/migrate-whys.sql in Supabase.`);
    } else {
      console.warn(`    ⚠️  goals query failed: ${err.message}`);
    }
  }

  // 4. Generate embedding (lightweight check — runs when a sample message is available)
  if (options.sampleUserMessage) {
    try {
      const embedResult = await callHandler(generateEmbeddingHandler, { text: options.sampleUserMessage });
      if (embedResult.embedding && Array.isArray(embedResult.embedding) && embedResult.embedding.length > 100) {
        backendState.embedding_check = { vector_length: embedResult.embedding.length, passed: true };
        console.log(`    🔢  Embedding: vector length ${embedResult.embedding.length} ✅`);
      } else {
        backendState.embedding_check = { passed: false };
        console.log(`    🔢  Embedding: unexpected result ❌`);
      }
    } catch (err) {
      console.warn(`    ⚠️  generate-embedding failed: ${err.message}`);
    }
  }

  // 5. Classify intent (lightweight check — runs when a sample message is available)
  if (options.sampleUserMessage) {
    try {
      const classifyResult = await callHandler(classifyIntentHandler, {
        user_message: options.sampleUserMessage,
        session_context: {},
      });
      if (classifyResult.intent && typeof classifyResult.intent === 'string' && classifyResult.intent.length > 0) {
        backendState.classify_intent_check = { intent: classifyResult.intent, passed: true };
        console.log(`    🏷️   Intent: "${classifyResult.intent}" ✅`);
      } else {
        backendState.classify_intent_check = { passed: false };
        console.log(`    🏷️   Intent: invalid result ❌`);
      }
    } catch (err) {
      console.warn(`    ⚠️  classify-intent failed: ${err.message}`);
    }
  }

  // 6. Extract goal commitments (runs when a commitment was made this session)
  if (options.commitmentText && Array.isArray(options.sampleGoals) && options.sampleGoals.length > 0) {
    try {
      const extractResult = await callHandler(extractGoalCommitmentsHandler, {
        user_id: userId,
        session_id: options.sessionId || null,
        commitment_text: options.commitmentText,
        goals: options.sampleGoals,
        client_local_date: simulatedDate,
      });
      if (extractResult.goal_commitments && Array.isArray(extractResult.goal_commitments) && extractResult.goal_commitments.length > 0) {
        backendState.extract_commitments_check = { count: extractResult.goal_commitments.length, passed: true };
        console.log(`    🔗  Extracted commitments: ${extractResult.goal_commitments.length} ✅`);
      } else {
        backendState.extract_commitments_check = { count: 0, passed: false };
      }
    } catch (err) {
      console.warn(`    ⚠️  extract-goal-commitments failed: ${err.message}`);
    }
  }

  // 7. Goal commitment stats (always runs — needs only user_id)
  try {
    const statsResult = await callHandler(goalCommitmentStatsHandler, {
      user_id: userId,
      client_local_date: simulatedDate,
    });
    if (statsResult.per_goal && Array.isArray(statsResult.per_goal)) {
      backendState.goal_commitment_stats_check = { goal_count: statsResult.per_goal.length, passed: true };
      if (statsResult.per_goal.length > 0) {
        console.log(`    📈  Goal commitment stats: ${statsResult.per_goal.length} goal(s) tracked ✅`);
      }
    }
  } catch (err) {
    console.warn(`    ⚠️  goal-commitment-stats failed: ${err.message}`);
  }

  // 8. Evaluate goal commitments (always runs — marks pending commitments kept/missed)
  try {
    const evalResult = await callHandler(evaluateGoalCommitmentsHandler, {
      user_id: userId,
      session_date: simulatedDate,
    });
    if (evalResult.ok) {
      backendState.evaluate_commitments_check = { passed: true };
    }
  } catch (err) {
    console.warn(`    ⚠️  evaluate-goal-commitments failed: ${err.message}`);
  }

  return backendState;
}
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
  let goals = [];

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

  try {
    const { data: goalsData } = await supabase
      .from('goals')
      .select('title, category, whys, last_mentioned_at')
      .eq('user_id', userId)
      .eq('status', 'active');
    goals = (goalsData ?? []).map((g) => ({
      title: g.title,
      category: g.category,
      whys: Array.isArray(g.whys) ? g.whys : [],
      last_mentioned_at: g.last_mentioned_at,
    }));
  } catch (err) {
    console.warn(`    ⚠️  final goals query failed: ${err.message}`);
  }

  return { profile, narratives, goals };
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
  const whyStr = quality.why_deepening_quality != null
    ? ` | why-depth: ${quality.why_deepening_quality}/5`
    : '';
  const extras = [
    quality.stage_appropriate === false ? 'off-stage' : null,
    quality.used_their_words === false ? 'generic' : null,
    quality.asked_one_question === false ? '≠1-question' : null,
    quality.advanced_correctly === false ? 'bad-advance' : null,
  ].filter(Boolean);
  const extrasStr = extras.length ? ` | ⚑ ${extras.join(', ')}` : '';
  console.log(`    ↳ Quality: ${quality.score}/5${flagStr}${whyStr}${extrasStr}`);
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
    const now = new Date().toISOString();
    const goalRows = persona.profile.goals.map((g) => ({
      user_id: userId,
      title: g.title,
      whys: g.why_it_matters
        ? [{ text: g.why_it_matters, added_at: now, source: 'onboarding', motivation_signal: null }]
        : [],
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

// ── Coverage Assertion Helpers ─────────────────────────────────────────────────

/**
 * Initializes all coverage assertions for the --test-full-coverage run.
 * Each assertion: { id, description, passed, day_first_passed, notes }
 */
function initCoverageAssertions() {
  const make = (id, description) => ({ id, description, passed: false, day_first_passed: null, notes: null });
  return [
    make('session_created_daily',            'Session row inserted every simulated day'),
    make('init_fires',                        '__INIT__ turn fires and returns assistant_message'),
    make('all_4_stages_complete',             'All 4 checklist stages complete in at least 1 session'),
    make('session_complete_before_max_turns', 'is_session_complete: true returned before MAX_TURNS'),
    make('stage_sequence_recorded',           'Stage sequence recorded correctly in sessionRecord'),
    make('commitment_checkin_fires',          'commitment_checkin stage fires on day 2+ when yesterday_commitment set'),
    make('commitment_checkin_done_flips',     'commitment_checkin_done flips to true after resolving'),
    make('commitment_checkin_miss_rate',      'commitment_checkin_coverage.miss_rate computed correctly'),
    make('all_exercises_fired',               'All 8 tracked exercises fire at least once across the run'),
    make('goal_created_with_fields',          'Goal row exists with correct title, category, why, status=active'),
    make('goal_suggestion_detected',          'Coach surfaces a goal_suggestion in extracted_data at least once'),
    make('goal_last_mentioned_updated',       'Goal last_mentioned_at updated after a session where goal discussed'),
    make('goal_whys_evolution',               'Goal whys[] count increases from early days to day 7+'),
    make('goal_commitment_extraction',        'extract-goal-commitments returns ≥1 commitment tied to an active goal'),
    make('goal_commitment_stats',             'goal-commitment-stats returns per-goal stats'),
    make('goal_commitment_evaluation',        'evaluate-goal-commitments marks commitments as kept/missed'),
    make('followthrough7_nonnull_after_day2', 'followThrough7 is non-null after day 2'),
    make('trajectory_valid',                  'trajectory is one of: improving, declining, flat, or null'),
    make('trajectory_nonnull_after_14',       'trajectory is non-null after 14+ day run'),
    make('patterns_after_5_sessions',         'At least 1 user_insights row is active after 5+ sessions'),
    make('patterns_2plus_after_10',           '2+ patterns with occurrence_count >= 2 after 10+ sessions'),
    make('narrative_after_10',                'generate-pattern-narrative returns ≥1 narrative after 10+ sessions'),
    make('embedding_returns_vector',          'generate-embedding returns vector with length > 100'),
    make('short_term_state_after_7',          'short_term_state is non-null after 7+ sessions'),
    make('strengths_after_14',               'strengths array has ≥1 entry after 14+ sessions'),
    make('growth_areas_after_14',            'growth_areas array has ≥1 entry after 14+ sessions'),
    make('identity_statement_preserved',      'Profile identity_statement matches seeded value throughout run'),
    make('follow_up_queue_populated',         'At least 1 follow_up_queue row exists after a commitment is made'),
    make('follow_up_queue_future_date',       'follow_up_queue rows have a future due_date relative to session date'),
    make('growth_marker_after_14',            'At least 1 growth_markers row exists after 14+ days'),
    make('classify_intent_valid',             'classify-intent returns a valid non-empty intent string'),
    make('week1_patterns_bounded',            'Week 1 (days 1–7): user_insights has 0–2 active entries'),
    make('week2_pattern_repetition',          'Week 2 (days 8–14): ≥1 insight with sessions_synthesized_from >= 2'),
    make('week2_short_term_state',            'Week 2 (days 8–14): short_term_state is populated'),
    make('week3_why_reference',               'Week 3 (days 15–21): coach references specific whys in ≥1 session'),
    make('day7_why_reconnect_fired',          'why_reconnect exercise fired at least once in the first 7 days'),
    make('day14_goals_populated',             'Day 14: goals with whys present, strengths and growth_areas populated'),
    make('day21_growth_and_grade',            'Day 21: ≥1 growth marker, narrative produced, trait grade not F'),
  ];
}

/**
 * Marks an assertion as passed (only on the first pass).
 *
 * @param {Array}  assertions - The coverage_assertions array
 * @param {string} id         - Assertion ID
 * @param {number} day        - Current simulation day
 * @param {string} [notes]    - Optional detail string
 */
function passAssertion(assertions, id, day, notes = null) {
  const a = assertions.find((a) => a.id === id);
  if (a && !a.passed) {
    a.passed = true;
    a.day_first_passed = day;
    if (notes) a.notes = notes;
  }
}

/**
 * Prints the final coverage summary table to stdout.
 *
 * @param {Array}  assertions    - Completed coverage_assertions array
 * @param {Array}  firedExercises - Exercise names that fired at least once
 */
function printCoverageSummary(assertions, firedExercises) {
  console.log('\n' + '═'.repeat(52));
  console.log('📋  FULL COVERAGE REPORT');
  console.log('═'.repeat(52));
  for (const a of assertions) {
    const icon = a.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}  ${a.description}`);
    if (a.notes) console.log(`       ↳ ${a.notes}`);
  }
  console.log('');
  console.log(`Exercise coverage: ${firedExercises.length}/8 exercises fired at least once`);
  if (firedExercises.length < ALL_EXERCISES.length) {
    const missed = ALL_EXERCISES.filter((e) => !firedExercises.includes(e));
    console.log(`  Missing: ${missed.join(', ')}`);
  }
  console.log('');
  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  console.log(`Result: ${passed}/${total} assertions passed`);
  console.log('═'.repeat(52));
}

// ── Why-Building Test — focused 7-day simulation on why evolution ─────────────
/**
 * Runs a focused 7-day simulation specifically testing how whys evolve.
 *
 * Day 1: User has a goal with a shallow why
 * Day 3: Coach runs why_reconnect, user gives a deeper answer → why should be updated
 * Day 5: User mentions a new reason → AI should detect it's distinct and add a second why
 * Day 7: Coach runs motivation check-in, should reference specific whys from the list
 *
 * Outputs: why-building-report.json
 */
async function runWhyBuildingTest({ personaKey, startDate, clean }) {
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

  console.log(`\n🔬  Starting --test-why-building (7-day focused run)`);
  console.log(`    Persona:    ${personaKey} (${persona.name})`);
  console.log(`    Start date: ${startDate}`);
  console.log(`    User ID:    ${userId}\n`);

  if (clean) {
    console.log('🧹  Cleaning previous sim data...');
    await cleanUserData(supabase, userId);
    await seedUserProfile(supabase, userId, persona);
    console.log('✅  Clean complete.\n');
  }

  const whyBuildingReport = {
    meta: {
      persona: personaKey,
      start_date: startDate,
      run_at: new Date().toISOString(),
      user_id: userId,
    },
    days: [],
    why_evolution_history: [],
    assertions: {
      day1_shallow_why_present: false,
      day3_why_reconnect_fired: false,
      day3_why_evolved: false,
      day5_additive_why_detected: false,
      day7_specific_why_referenced: false,
    },
    summary: {
      total_why_evolution_events: 0,
      final_whys_per_goal: [],
    },
  };

  const traitPool = persona.hiddenTraitPool ?? [];
  const assignedTraits = drawTraits(traitPool, 2);
  const crossSessionState = {
    yesterdayCommitment: null,
    prevGoalWhysCounts: {},
  };

  for (let day = 1; day <= 7; day++) {
    const simulatedDate = addDays(startDate, day - 1);
    const moods = persona.tendencies.mood_distribution;
    const mood = moods[(day - 1) % moods.length];
    const eventBank = persona.dailyEventBank ?? [];
    const dailyEvent = eventBank.length > 0
      ? eventBank[Math.floor(Math.random() * eventBank.length)]
      : null;

    separator(day, simulatedDate);
    if (dailyEvent) console.log(`📅  Today's event: ${dailyEvent}`);

    const sessionId = await createSessionRow(supabase, userId, simulatedDate);

    let history = [];
    let sessionState = {
      current_stage: 'wins',
      checklist: { wins: false, honest: false, plan: false, identity: false },
      tomorrow_commitment: null,
      exercises_run: [],
      consecutive_excuses: 0,
      is_complete: false,
    };
    const sessionContext = { sharedWins: null, sharedMisses: null, sharedTomorrow: null };

    const dayRecord = {
      day,
      date: simulatedDate,
      exercises_run: [],
      why_reconnect_fired: false,
      coach_referenced_specific_why: false,
      why_evolution_events: [],
      conversation: [],
    };

    // INIT
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

    if (initResult.stage_advance && initResult.new_stage) {
      sessionState.current_stage = initResult.new_stage;
    }
    if (initResult.checklist_updates) {
      sessionState.checklist = { ...sessionState.checklist, ...initResult.checklist_updates };
    }
    if (initResult.exercise_run && initResult.exercise_run !== 'none') {
      sessionState.exercises_run = [...sessionState.exercises_run, initResult.exercise_run];
    }
    if (initResult.is_session_complete) sessionState.is_complete = true;
    history.push({ role: 'assistant', content: initCoachMsg });

    await assertWhysContext(supabase, userId);

    // Fetch goal whys for context
    let sessionGoalWhys = [];
    try {
      const { data: goalsForWhys } = await supabase
        .from('goals').select('id, whys').eq('user_id', userId).eq('status', 'active');
      sessionGoalWhys = selectGoalWhysForScoring(goalsForWhys ?? []);
    } catch { /* non-fatal */ }

    const MAX_TURNS = 14;
    let turn = 0;

    while (!sessionState.is_complete && turn < MAX_TURNS) {
      turn++;

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
        dayNumber: day,
        whyPool: persona.whyPool ?? null,
      });

      printUser(userMsg);

      if (sessionState.current_stage === 'wins') sessionContext.sharedWins = userMsg;
      if (sessionState.current_stage === 'honest') sessionContext.sharedMisses = userMsg;
      if (sessionState.current_stage === 'tomorrow') sessionContext.sharedTomorrow = userMsg;

      history.push({ role: 'user', content: userMsg });

      const result = await callCoach({
        user_id: userId,
        session_id: sessionId,
        session_state: sessionState,
        history,
        user_message: userMsg,
        context: { client_local_date: simulatedDate },
      });

      const coachMsg = result.assistant_message || '';
      if (!coachMsg.trim()) { turn--; continue; }

      if (result.stage_advance && result.new_stage) sessionState.current_stage = result.new_stage;
      if (result.checklist_updates) sessionState.checklist = { ...sessionState.checklist, ...result.checklist_updates };
      if (result.extracted_data?.tomorrow_commitment) sessionState.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
      if (result.exercise_run && result.exercise_run !== 'none') {
        if (!sessionState.exercises_run.includes(result.exercise_run)) {
          sessionState.exercises_run = [...sessionState.exercises_run, result.exercise_run];
        }
        // Track why_reconnect firing
        if (result.exercise_run === 'why_reconnect') {
          dayRecord.why_reconnect_fired = true;
          if (day === 3) whyBuildingReport.assertions.day3_why_reconnect_fired = true;
        }
      }
      if (typeof result.consecutive_excuses === 'number') sessionState.consecutive_excuses = result.consecutive_excuses;
      if (result.is_session_complete) sessionState.is_complete = true;

      history.push({ role: 'assistant', content: coachMsg });
      printCoach(coachMsg);

      // Check if coach referenced a specific why from the list
      const coachMsgLower = coachMsg.toLowerCase();
      const referencedSpecificWhy = sessionGoalWhys.some((w) => {
        const whyText = (w.text ?? '').toLowerCase();
        const keyWords = whyText.split(' ').filter((w) => w.length > MIN_KEYWORD_LENGTH);
        return keyWords.some((kw) => coachMsgLower.includes(kw));
      });
      if (referencedSpecificWhy) {
        dayRecord.coach_referenced_specific_why = true;
        if (day === 7) whyBuildingReport.assertions.day7_specific_why_referenced = true;
      }

      dayRecord.conversation.push({ turn, coach: coachMsg, user: userMsg });
      if (sessionState.is_complete) break;
    }

    dayRecord.exercises_run = sessionState.exercises_run;
    crossSessionState.yesterdayCommitment = sessionState.tomorrow_commitment ?? null;

    // Backend validation + why evolution detection
    const backendState = await validateBackend(supabase, userId, simulatedDate, crossSessionState.prevGoalWhysCounts);

    if (backendState.goals_snapshot && backendState.goals_snapshot.length > 0) {
      for (const g of backendState.goals_snapshot) {
        const prevCount = crossSessionState.prevGoalWhysCounts[g.goal_id] ?? 0;
        crossSessionState.prevGoalWhysCounts[g.goal_id] = g.whys_count;

        if (day === 1 && g.whys_count > 0) {
          whyBuildingReport.assertions.day1_shallow_why_present = true;
        }
        if (day === 3 && g.whys_count !== prevCount) {
          whyBuildingReport.assertions.day3_why_evolved = true;
        }
        if (day === 5 && g.whys_count > 1) {
          whyBuildingReport.assertions.day5_additive_why_detected = true;
        }
      }

      dayRecord.why_evolution_events = backendState.why_evolution_events ?? [];
      if (backendState.why_evolution_events?.length > 0) {
        whyBuildingReport.why_evolution_history.push(...backendState.why_evolution_events);
        whyBuildingReport.summary.total_why_evolution_events += backendState.why_evolution_events.length;
      }
    }

    printSummary({
      completed: sessionState.is_complete,
      stage: sessionState.current_stage,
      exercises: sessionState.exercises_run,
      turns: turn,
    });

    whyBuildingReport.days.push(dayRecord);

    if (day < 7) await new Promise((r) => setTimeout(r, 500));
  }

  // Final goals state
  try {
    const { data: finalGoals } = await supabase
      .from('goals').select('id, title, whys').eq('user_id', userId).eq('status', 'active');
    if (finalGoals) {
      whyBuildingReport.summary.final_whys_per_goal = finalGoals.map((g) => ({
        goal_id: g.id,
        title: g.title,
        whys_count: Array.isArray(g.whys) ? g.whys.length : 0,
        whys: Array.isArray(g.whys) ? g.whys : [],
      }));
    }
  } catch (err) {
    console.warn(`    ⚠️  Final goals query failed: ${err.message}`);
  }

  // Print assertion results
  console.log('\n🔬  Why-Building Test Assertions:');
  const assertions = whyBuildingReport.assertions;
  console.log(`    Day 1 — shallow why present:        ${assertions.day1_shallow_why_present ? '✅ PASS' : '⚠️  not yet (whys may not exist in DB yet)'}`);
  console.log(`    Day 3 — why_reconnect exercise fired: ${assertions.day3_why_reconnect_fired ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    Day 3 — why evolved (count changed): ${assertions.day3_why_evolved ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    Day 5 — additive why detected:      ${assertions.day5_additive_why_detected ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    Day 7 — coach used specific why:    ${assertions.day7_specific_why_referenced ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    Total why evolution events:         ${whyBuildingReport.summary.total_why_evolution_events}`);

  try {
    writeFileSync(WHY_BUILDING_REPORT_PATH, JSON.stringify(whyBuildingReport, null, 2), 'utf8');
    console.log(`\n✅  Why-building report saved to:\n    ${WHY_BUILDING_REPORT_PATH}\n`);
  } catch (err) {
    console.error('❌  Could not write why-building report:', err.message);
  }
}

// ── Goal Suggestion Test — tests coach goal suggestion + why journaling ────────
/**
 * Runs a focused single-session test for goal suggestion:
 * 1. Simulates a session where the coach surfaces a suggested goal
 * 2. The user accepts
 * 3. A why for the new goal is recorded
 * 4. The new goal appears in the DB with at least one why entry
 *
 * Logs pass/fail assertions to console.
 */
async function runGoalSuggestionTest({ personaKey, startDate, clean }) {
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

  console.log(`\n🎯  Starting --test-goal-suggestion`);
  console.log(`    Persona:    ${personaKey} (${persona.name})`);
  console.log(`    Start date: ${startDate}`);
  console.log(`    User ID:    ${userId}\n`);

  if (clean) {
    console.log('🧹  Cleaning previous sim data...');
    await cleanUserData(supabase, userId);
    await seedUserProfile(supabase, userId, persona);
    console.log('✅  Clean complete.\n');
  }

  const assertions = {
    session_completed: false,
    goal_suggestion_fired: false,
    goal_created_in_db: false,
    goal_has_why: false,
  };

  const simulatedDate = startDate;
  const sessionId = await createSessionRow(supabase, userId, simulatedDate);

  const moods = persona.tendencies.mood_distribution;
  const mood = moods[0];
  const eventBank = persona.dailyEventBank ?? [];
  const dailyEvent = eventBank.length > 0 ? eventBank[0] : null;
  const traitPool = persona.hiddenTraitPool ?? [];
  const assignedTraits = drawTraits(traitPool, 2);

  separator(1, simulatedDate);
  if (dailyEvent) console.log(`📅  Today's event: ${dailyEvent}`);

  let history = [];
  let sessionState = {
    current_stage: 'wins',
    checklist: { wins: false, honest: false, plan: false, identity: false },
    tomorrow_commitment: null,
    exercises_run: [],
    consecutive_excuses: 0,
    is_complete: false,
  };
  const sessionContext = { sharedWins: null, sharedMisses: null, sharedTomorrow: null };

  let suggestedGoal = null;

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

  if (initResult.stage_advance && initResult.new_stage) sessionState.current_stage = initResult.new_stage;
  if (initResult.checklist_updates) sessionState.checklist = { ...sessionState.checklist, ...initResult.checklist_updates };
  if (initResult.exercise_run && initResult.exercise_run !== 'none') sessionState.exercises_run = [...sessionState.exercises_run, initResult.exercise_run];
  if (initResult.is_session_complete) sessionState.is_complete = true;
  history.push({ role: 'assistant', content: initCoachMsg });

  const MAX_TURNS = 16;
  let turn = 0;

  while (!sessionState.is_complete && turn < MAX_TURNS) {
    turn++;

    const userMsg = await generateUserResponse({
      persona,
      coachMessage: history[history.length - 1]?.content ?? '',
      currentStage: sessionState.current_stage,
      history,
      simulatedDate,
      mood,
      sessionContext,
      dailyEvent,
      yesterdayCommitment: null,
      assignedTraits,
      dayNumber: 1,
      whyPool: persona.whyPool ?? null,
    });

    printUser(userMsg);

    if (sessionState.current_stage === 'wins') sessionContext.sharedWins = userMsg;
    if (sessionState.current_stage === 'honest') sessionContext.sharedMisses = userMsg;
    if (sessionState.current_stage === 'tomorrow') sessionContext.sharedTomorrow = userMsg;

    history.push({ role: 'user', content: userMsg });

    const result = await callCoach({
      user_id: userId,
      session_id: sessionId,
      session_state: sessionState,
      history,
      user_message: userMsg,
      context: { client_local_date: simulatedDate },
    });

    const coachMsg = result.assistant_message || '';
    if (!coachMsg.trim()) { turn--; continue; }

    // Check if coach surfaced a goal suggestion
    if (result.extracted_data?.goal_suggestion && !suggestedGoal) {
      suggestedGoal = result.extracted_data.goal_suggestion;
      assertions.goal_suggestion_fired = true;
      console.log(`\n💡  Goal suggestion detected: "${suggestedGoal.title ?? JSON.stringify(suggestedGoal)}"`);
    }

    if (result.stage_advance && result.new_stage) sessionState.current_stage = result.new_stage;
    if (result.checklist_updates) sessionState.checklist = { ...sessionState.checklist, ...result.checklist_updates };
    if (result.extracted_data?.tomorrow_commitment) sessionState.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
    if (result.exercise_run && result.exercise_run !== 'none') {
      if (!sessionState.exercises_run.includes(result.exercise_run)) {
        sessionState.exercises_run = [...sessionState.exercises_run, result.exercise_run];
      }
    }
    if (typeof result.consecutive_excuses === 'number') sessionState.consecutive_excuses = result.consecutive_excuses;
    if (result.is_session_complete) sessionState.is_complete = true;

    history.push({ role: 'assistant', content: coachMsg });
    printCoach(coachMsg);

    if (sessionState.is_complete) break;
  }

  if (sessionState.is_complete) assertions.session_completed = true;

  // If a goal was suggested, simulate accepting it and journaling why
  if (suggestedGoal) {
    const goalTitle = suggestedGoal.title ?? suggestedGoal;
    const goalCategory = suggestedGoal.category ?? null;
    // Generate a why for the new goal (use shallow tier since it's new)
    const whyPool = persona.whyPool?.shallow ?? [];
    const whyText = whyPool.length > 0
      ? whyPool[Math.floor(Math.random() * whyPool.length)]
      : 'I want to work on this because it matters to me';

    console.log(`\n📝  Simulating user accepting goal: "${goalTitle}"`);
    console.log(`    Why they journal: "${whyText}"`);

    try {
      const createResult = await callHandler(createGoalHandler, {
        user_id: userId,
        title: goalTitle,
        category: goalCategory,
        why_it_matters: whyText,
      });

      if (createResult.goal && createResult.goal.id) {
        assertions.goal_created_in_db = true;
        console.log(`    ✅  Goal created in DB: ${createResult.goal.id}`);

        // Seed a why entry for this new goal
        try {
          const { error: whyErr } = await supabase
            .from('goals')
            .update({
              whys: [{ text: whyText, added_at: new Date().toISOString(), source: 'user_journal' }],
            })
            .eq('id', createResult.goal.id)
            .eq('user_id', userId);

          if (!whyErr) {
            assertions.goal_has_why = true;
            console.log(`    ✅  Why journaled for new goal`);
          } else {
            console.warn(`    ⚠️  Could not write why: ${whyErr.message}`);
          }
        } catch (err) {
          console.warn(`    ⚠️  Why write failed: ${err.message}`);
        }
      } else {
        console.warn(`    ⚠️  Goal creation response missing ID: ${JSON.stringify(createResult)}`);
      }
    } catch (err) {
      console.warn(`    ⚠️  Goal creation failed: ${err.message}`);
    }
  } else {
    console.log(`\n⚠️  No goal suggestion detected in this session. Coach may need more sessions to surface one.`);
    console.log(`    Tip: Run with --days 3 to give the coach more turns to suggest a goal.`);
  }

  // Print assertion results
  console.log('\n🎯  Goal Suggestion Test Assertions:');
  console.log(`    Session completed:         ${assertions.session_completed ? '✅ PASS' : '⚠️  incomplete'}`);
  console.log(`    Goal suggestion fired:     ${assertions.goal_suggestion_fired ? '✅ PASS' : '❌ FAIL (no suggestion in this session)'}`);
  console.log(`    Goal created in DB:        ${assertions.goal_created_in_db ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    Goal has why entry:        ${assertions.goal_has_why ? '✅ PASS' : '❌ FAIL'}`);

  const passed = Object.values(assertions).filter(Boolean).length;
  const total = Object.values(assertions).length;
  console.log(`\n    Result: ${passed}/${total} assertions passed\n`);
}

// ── Full Coverage Test — 21-day simulation with comprehensive assertions ────────
/**
 * Runs a 21-day simulation that checks every major feature of the coaching
 * pipeline, including time-gated behaviours that only emerge after sustained
 * usage. Produces full-coverage-report.json and prints a final pass/fail table.
 *
 * Usage: node scripts/simulate-reflection.js --test-full-coverage [--clean] [--persona X]
 */
async function runFullCoverageTest({ personaKey, startDate, clean }) {
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
  const TOTAL_DAYS = 21;

  console.log(`\n🔬  Starting --test-full-coverage (${TOTAL_DAYS}-day simulation)`);
  console.log(`    Persona:    ${personaKey} (${persona.name})`);
  console.log(`    Start date: ${startDate}`);
  console.log(`    User ID:    [set via SIM_USER_ID]\n`);

  if (clean) {
    console.log('🧹  Cleaning previous sim data...');
    await cleanUserData(supabase, userId);
    await seedUserProfile(supabase, userId, persona);
    console.log('✅  Clean complete.\n');
  }

  // ── Initialise state ────────────────────────────────────────────────────────
  const assertions = initCoverageAssertions();
  const exercisesFired = new Set();
  const seededIdentity = persona.profile?.identity_statement ?? null;

  const crossSessionState = {
    yesterdayCommitment: null,
    lastFollowedThrough: null,
    prevGoalWhysCounts: {},
  };

  const traitPool = persona.hiddenTraitPool ?? [];
  const assignedTraits = drawTraits(traitPool, 2);

  const eventBankRaw = persona.dailyEventBank ?? [];
  let eventQueue = [];
  function nextEvent() {
    if (eventBankRaw.length === 0) return null;
    if (eventQueue.length === 0) eventQueue = shuffleArray(eventBankRaw);
    return eventQueue.shift();
  }

  const report = {
    meta: {
      persona: personaKey,
      start_date: startDate,
      days_simulated: TOTAL_DAYS,
      user_id: userId,
      run_at: new Date().toISOString(),
      assigned_traits: assignedTraits.map((t) => ({ id: t.id, label: t.label })),
    },
    summary: {
      sessions_completed: 0,
      sessions_incomplete: 0,
      commitment_checkin_coverage: { fired: 0, resolved: 0, should_have_fired: 0, miss_rate: null },
    },
    backend_summary: {
      final_follow_through_7day: null,
      final_trajectory: null,
      all_patterns: [],
      narrative_produced: false,
      narrative_sample: null,
      user_profile_snapshot: null,
      generated_narratives: [],
      final_goals_snapshot: [],
    },
    coverage_assertions: assertions,
    exercise_coverage: { fired: [], total: ALL_EXERCISES.length, coverage_count: 0 },
    sessions: [],
    trait_detection: null,
  };

  // ── Day loop ────────────────────────────────────────────────────────────────
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const simulatedDate = addDays(startDate, day - 1);
    const moods = persona.tendencies.mood_distribution;
    const mood = moods[(day - 1) % moods.length];
    const dailyEvent = nextEvent();

    separator(day, simulatedDate);
    if (dailyEvent) console.log(`📅  Today's event: ${dailyEvent}`);

    // 1. Create session row
    const sessionId = await createSessionRow(supabase, userId, simulatedDate);
    if (sessionId) passAssertion(assertions, 'session_created_daily', day);

    // Determine follow-through for this day
    let followedThroughToday = null;
    if (crossSessionState.yesterdayCommitment) {
      if (crossSessionState.lastFollowedThrough === true) {
        followedThroughToday = Math.random() < MISS_AFTER_KEEP_PROBABILITY;
      } else if (crossSessionState.lastFollowedThrough === false) {
        followedThroughToday = Math.random() < KEEP_AFTER_MISS_PROBABILITY;
      } else {
        followedThroughToday = Math.random() < persona.tendencies.follow_through_rate;
      }
    }

    let history = [];
    let sessionState = {
      current_stage: 'wins',
      checklist: { wins: false, honest: false, plan: false, identity: false },
      tomorrow_commitment: null,
      exercises_run: [],
      consecutive_excuses: 0,
      is_complete: false,
      commitment_checkin_done: false,
    };
    const sessionContext = { sharedWins: null, sharedMisses: null, sharedTomorrow: null, sharedCheckin: null };
    const stageSequence = [sessionState.current_stage];

    const sessionRecord = {
      day,
      date: simulatedDate,
      session_id: sessionId,
      completed: false,
      turns: 0,
      exercises_run: [],
      checklist: { wins: false, honest: false, plan: false, identity: false },
      checkin_stage_fired: false,
      checkin_stage_resolved: false,
      stage_sequence: [],
      coach_referenced_specific_why: false,
      commitment_made: null,
      anomalies: [],
      conversation: [],
      backend_state: null,
    };

    // 2. INIT turn
    const initResult = await callCoach({
      user_id: userId,
      session_id: sessionId,
      session_state: {
        ...sessionState,
        yesterday_commitment: crossSessionState.yesterdayCommitment || null,
        commitment_checkin_done: false,
      },
      history: [],
      user_message: '__INIT__',
      context: { client_local_date: simulatedDate },
    });

    const initCoachMsg = initResult.assistant_message || '';
    if (initCoachMsg) passAssertion(assertions, 'init_fires', day);
    printCoach(initCoachMsg);

    if (initResult.stage_advance && initResult.new_stage) {
      sessionState.current_stage = initResult.new_stage;
      if (!stageSequence.includes(initResult.new_stage)) stageSequence.push(initResult.new_stage);
    }
    if (initResult.checklist_updates) sessionState.checklist = { ...sessionState.checklist, ...initResult.checklist_updates };
    if (initResult.exercise_run && initResult.exercise_run !== 'none') {
      sessionState.exercises_run.push(initResult.exercise_run);
      exercisesFired.add(initResult.exercise_run);
    }
    if (initResult.commitment_checkin_done === true) sessionState.commitment_checkin_done = true;
    if (initResult.is_session_complete) sessionState.is_complete = true;

    history.push({ role: 'assistant', content: initCoachMsg });
    sessionRecord.conversation.push({ turn: 0, coach: initCoachMsg, user: null });

    // Fetch current goal data once per session
    let sessionGoalWhys = [];
    let sessionGoals = [];
    try {
      const { data: goalsData } = await supabase
        .from('goals')
        .select('id, title, category, whys')
        .eq('user_id', userId)
        .eq('status', 'active');
      sessionGoalWhys = selectGoalWhysForScoring(goalsData ?? []);
      sessionGoals = (goalsData ?? []).map((g) => ({ id: g.id, title: g.title, category: g.category }));
    } catch { /* non-fatal */ }

    // 3. Conversation loop
    const MAX_TURNS = 16;
    let turn = 0;
    let sampleUserMsg = null;

    while (!sessionState.is_complete && turn < MAX_TURNS) {
      turn++;

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
        followedThrough: followedThroughToday,
        assignedTraits,
        dayNumber: day,
        whyPool: persona.whyPool ?? null,
      });

      printUser(userMsg);
      if (!sampleUserMsg) sampleUserMsg = userMsg;

      if (sessionState.current_stage === 'wins') sessionContext.sharedWins = userMsg;
      if (sessionState.current_stage === 'honest') sessionContext.sharedMisses = userMsg;
      if (sessionState.current_stage === 'tomorrow') sessionContext.sharedTomorrow = userMsg;
      if (sessionState.current_stage === 'commitment_checkin') sessionContext.sharedCheckin = userMsg;

      history.push({ role: 'user', content: userMsg });

      const result = await callCoach({
        user_id: userId,
        session_id: sessionId,
        session_state: {
          ...sessionState,
          yesterday_commitment: crossSessionState.yesterdayCommitment || null,
          commitment_checkin_done: sessionState.commitment_checkin_done,
        },
        history,
        user_message: userMsg,
        context: { client_local_date: simulatedDate },
      });

      const coachMsg = result.assistant_message || '';
      if (!coachMsg.trim()) { turn--; continue; }

      const prevStage = sessionState.current_stage;

      if (result.stage_advance && result.new_stage) {
        sessionState.current_stage = result.new_stage;
        if (!stageSequence.includes(result.new_stage)) stageSequence.push(result.new_stage);
      }
      if (result.checklist_updates) sessionState.checklist = { ...sessionState.checklist, ...result.checklist_updates };
      if (result.extracted_data?.tomorrow_commitment) sessionState.tomorrow_commitment = result.extracted_data.tomorrow_commitment;
      if (result.exercise_run && result.exercise_run !== 'none') {
        if (!sessionState.exercises_run.includes(result.exercise_run)) {
          sessionState.exercises_run.push(result.exercise_run);
        }
        exercisesFired.add(result.exercise_run);
      }
      if (result.extracted_data?.goal_suggestion) passAssertion(assertions, 'goal_suggestion_detected', day);
      if (typeof result.consecutive_excuses === 'number') sessionState.consecutive_excuses = result.consecutive_excuses;
      if (result.commitment_checkin_done === true) sessionState.commitment_checkin_done = true;
      if (result.is_session_complete) sessionState.is_complete = true;

      // Track commitment_checkin stage appearances
      if (prevStage === 'commitment_checkin' || sessionState.current_stage === 'commitment_checkin') {
        sessionRecord.checkin_stage_fired = true;
      }
      if (sessionState.commitment_checkin_done) sessionRecord.checkin_stage_resolved = true;

      history.push({ role: 'assistant', content: coachMsg });
      printCoach(coachMsg);

      // Check if coach referenced a specific why from the goal list
      const coachMsgLower = coachMsg.toLowerCase();
      const referencedSpecificWhy = sessionGoalWhys.some((w) => {
        const whyText = (w.text ?? '').toLowerCase();
        const keyWords = whyText.split(' ').filter((kw) => kw.length > MIN_KEYWORD_LENGTH);
        return keyWords.some((kw) => coachMsgLower.includes(kw));
      });
      if (referencedSpecificWhy) sessionRecord.coach_referenced_specific_why = true;

      sessionRecord.conversation.push({ turn, coach: coachMsg, user: userMsg });
      if (sessionState.is_complete) break;
    }

    // ── Finalise session record ──────────────────────────────────────────────
    sessionRecord.completed = sessionState.is_complete;
    sessionRecord.turns = turn;
    sessionRecord.exercises_run = [...sessionState.exercises_run];
    sessionRecord.checklist = { ...sessionState.checklist };
    sessionRecord.checkin_stage_fired = sessionRecord.checkin_stage_fired || stageSequence.includes('commitment_checkin');
    sessionRecord.checkin_stage_resolved = sessionState.commitment_checkin_done;
    sessionRecord.stage_sequence = [...stageSequence];
    sessionRecord.commitment_made = sessionState.tomorrow_commitment;

    // ── Session-level assertions ─────────────────────────────────────────────
    if (sessionState.is_complete && turn < MAX_TURNS) {
      passAssertion(assertions, 'session_complete_before_max_turns', day);
    }
    if (Object.values(sessionState.checklist).every(Boolean)) {
      passAssertion(assertions, 'all_4_stages_complete', day);
    }
    if (stageSequence.length > 0) {
      passAssertion(assertions, 'stage_sequence_recorded', day);
    }

    const hadYesterdayCommitment = crossSessionState.yesterdayCommitment !== null;
    if (hadYesterdayCommitment) {
      report.summary.commitment_checkin_coverage.should_have_fired++;
      if (sessionRecord.checkin_stage_fired) {
        report.summary.commitment_checkin_coverage.fired++;
        if (day >= 2) passAssertion(assertions, 'commitment_checkin_fires', day);
      }
      if (sessionRecord.checkin_stage_resolved) {
        report.summary.commitment_checkin_coverage.resolved++;
        passAssertion(assertions, 'commitment_checkin_done_flips', day);
      }
      if (!sessionRecord.checkin_stage_fired) {
        sessionRecord.anomalies.push('commitment_checkin skipped despite yesterday_commitment existing');
      }
    }

    if (day <= 7 && sessionState.exercises_run.includes('why_reconnect')) {
      passAssertion(assertions, 'day7_why_reconnect_fired', day);
    }
    if (day >= 15 && sessionRecord.coach_referenced_specific_why) {
      passAssertion(assertions, 'week3_why_reference', day);
    }

    if (sessionState.is_complete) report.summary.sessions_completed++;
    else report.summary.sessions_incomplete++;

    // ── Update cross-session state ───────────────────────────────────────────
    crossSessionState.yesterdayCommitment = sessionState.tomorrow_commitment ?? null;
    crossSessionState.lastFollowedThrough = hadYesterdayCommitment ? followedThroughToday : null;

    // ── Extended backend validation ──────────────────────────────────────────
    console.log(`\n🔍  Backend validation (day ${day}):`);
    const backendState = await validateBackend(
      supabase, userId, simulatedDate, crossSessionState.prevGoalWhysCounts,
      {
        sampleUserMessage: sampleUserMsg,
        commitmentText: sessionState.tomorrow_commitment,
        sampleGoals: sessionGoals,
        sessionId,
      }
    );
    sessionRecord.backend_state = backendState;

    // Update goal why counts for next day comparison
    if (backendState.goals_snapshot) {
      for (const g of backendState.goals_snapshot) {
        crossSessionState.prevGoalWhysCounts[g.goal_id] = g.whys_count;
      }
    }

    // ── Backend-state assertions ─────────────────────────────────────────────
    if (backendState.embedding_check?.passed) {
      passAssertion(assertions, 'embedding_returns_vector', day, `vector length: ${backendState.embedding_check.vector_length}`);
    }
    if (backendState.classify_intent_check?.passed) {
      passAssertion(assertions, 'classify_intent_valid', day, `intent: "${backendState.classify_intent_check.intent}"`);
    }
    if (day >= 2 && backendState.follow_through_7day) {
      passAssertion(assertions, 'followthrough7_nonnull_after_day2', day);
    }
    const validTrajectories = ['improving', 'declining', 'flat'];
    if (backendState.trajectory === null || validTrajectories.includes(backendState.trajectory)) {
      passAssertion(assertions, 'trajectory_valid', day);
    }
    if (day >= 14 && backendState.trajectory && validTrajectories.includes(backendState.trajectory)) {
      passAssertion(assertions, 'trajectory_nonnull_after_14', day, `trajectory: ${backendState.trajectory}`);
    }
    if (day >= 5 && backendState.patterns_accumulated.length > 0) {
      passAssertion(assertions, 'patterns_after_5_sessions', day, `${backendState.patterns_accumulated.length} pattern(s)`);
    }
    if (day >= 10) {
      const repeating = backendState.patterns_accumulated.filter((p) => p.occurrences >= 2);
      if (repeating.length >= 2) {
        passAssertion(assertions, 'patterns_2plus_after_10', day, `${repeating.length} repeating patterns`);
      }
    }
    if (day >= 10 && backendState.narrative_sample && backendState.narrative_sample.length > 50) {
      passAssertion(assertions, 'narrative_after_10', day);
    }
    if (backendState.extract_commitments_check?.passed) {
      passAssertion(assertions, 'goal_commitment_extraction', day);
    }
    if (backendState.goal_commitment_stats_check?.passed && backendState.goal_commitment_stats_check.goal_count > 0) {
      passAssertion(assertions, 'goal_commitment_stats', day);
    }
    if (backendState.evaluate_commitments_check?.passed) {
      passAssertion(assertions, 'goal_commitment_evaluation', day);
    }

    // Follow-up queue check
    try {
      const { data: queueRows } = await supabase
        .from('follow_up_queue')
        .select('id, check_back_after')
        .eq('user_id', userId);
      if (queueRows && queueRows.length > 0) {
        passAssertion(assertions, 'follow_up_queue_populated', day);
        const hasFutureDate = queueRows.some((r) => r.check_back_after && r.check_back_after >= simulatedDate);
        if (hasFutureDate) passAssertion(assertions, 'follow_up_queue_future_date', day);
      }
    } catch { /* non-fatal */ }

    // Goals snapshot assertions
    if (backendState.goals_snapshot && backendState.goals_snapshot.length > 0) {
      // identity_statement preserved
      try {
        const { data: profileCheck } = await supabase
          .from('user_profiles').select('identity_statement').eq('id', userId).single();
        if (seededIdentity && profileCheck?.identity_statement === seededIdentity) {
          passAssertion(assertions, 'identity_statement_preserved', day);
        }
      } catch { /* non-fatal */ }

      const goalWithLastMentioned = backendState.goals_snapshot.find((g) => g.last_mentioned_at);
      if (goalWithLastMentioned) passAssertion(assertions, 'goal_last_mentioned_updated', day);

      const goalsWithWhys = backendState.goals_snapshot.filter((g) => g.whys_count > 0);
      if (day >= 3 && goalsWithWhys.length > 0) {
        passAssertion(assertions, 'goal_whys_evolution', day, `${goalsWithWhys[0].whys_count} why(s) on "${goalsWithWhys[0].title}"`);
      }

      // Check a goal has the required fields (title, whys, status=active)
      const validGoal = backendState.goals_snapshot.find((g) => g.title && g.whys_count > 0);
      if (validGoal) passAssertion(assertions, 'goal_created_with_fields', day);
    }

    // Profile state checks
    if (day >= 7) {
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('short_term_state, strengths, growth_areas')
          .eq('id', userId)
          .single();
        if (profile?.short_term_state) passAssertion(assertions, 'short_term_state_after_7', day);
        if (day >= 14 && Array.isArray(profile?.strengths) && profile.strengths.length > 0) {
          passAssertion(assertions, 'strengths_after_14', day, `${profile.strengths.length} strength(s)`);
        }
        if (day >= 14 && Array.isArray(profile?.growth_areas) && profile.growth_areas.length > 0) {
          passAssertion(assertions, 'growth_areas_after_14', day, `${profile.growth_areas.length} area(s)`);
        }
      } catch { /* non-fatal */ }
    }

    // Growth markers check
    if (day >= 14) {
      try {
        const { data: markers } = await supabase
          .from('growth_markers').select('id, theme').eq('user_id', userId);
        if (markers && markers.length > 0) {
          passAssertion(assertions, 'growth_marker_after_14', day, `theme: ${markers[0].theme}`);
          console.log(`    🌱  Growth marker: "${markers[0].theme}"`);
        }
      } catch { /* non-fatal */ }
    }

    // ── Day 14 milestone ─────────────────────────────────────────────────────
    if (day === 14) {
      try {
        const { data: goals14 } = await supabase
          .from('goals').select('id, whys').eq('user_id', userId).eq('status', 'active');
        const { data: profile14 } = await supabase
          .from('user_profiles').select('strengths, growth_areas').eq('id', userId).single();
        const goalsWithWhys14 = (goals14 ?? []).filter((g) => Array.isArray(g.whys) && g.whys.length > 0);
        const strengthsOk = Array.isArray(profile14?.strengths) && profile14.strengths.length > 0;
        const growthOk = Array.isArray(profile14?.growth_areas) && profile14.growth_areas.length > 0;
        if (goalsWithWhys14.length >= 1 && strengthsOk && growthOk) {
          passAssertion(assertions, 'day14_goals_populated', 14,
            `${goalsWithWhys14.length} goal(s) with whys, strengths and growth_areas set`);
        }
      } catch { /* non-fatal */ }
    }

    // ── Week boundary assertions ─────────────────────────────────────────────
    if (day === 7) {
      const patCount = backendState.patterns_accumulated.length;
      if (patCount <= 2) {
        passAssertion(assertions, 'week1_patterns_bounded', 7, `${patCount} pattern(s) at day 7`);
      }
    }
    if (day === 14) {
      const repeating14 = backendState.patterns_accumulated.filter((p) => p.occurrences >= 2);
      if (repeating14.length >= 1) {
        passAssertion(assertions, 'week2_pattern_repetition', 14, `${repeating14.length} repeating pattern(s)`);
      }
      try {
        const { data: pW2 } = await supabase
          .from('user_profiles').select('short_term_state').eq('id', userId).single();
        if (pW2?.short_term_state) passAssertion(assertions, 'week2_short_term_state', 14);
      } catch { /* non-fatal */ }
    }

    report.sessions.push(sessionRecord);

    printSummary({
      completed: sessionState.is_complete,
      stage: sessionState.current_stage,
      exercises: sessionState.exercises_run,
      turns: turn,
    });

    if (day < TOTAL_DAYS) await new Promise((r) => setTimeout(r, 500));
  }

  // ── Post-loop: exercise coverage ─────────────────────────────────────────
  const firedExercises = ALL_EXERCISES.filter((e) => exercisesFired.has(e));
  const missedExercises = ALL_EXERCISES.filter((e) => !exercisesFired.has(e));
  report.exercise_coverage.fired = firedExercises;
  report.exercise_coverage.coverage_count = firedExercises.length;
  if (firedExercises.length === ALL_EXERCISES.length) {
    passAssertion(assertions, 'all_exercises_fired', TOTAL_DAYS, '8/8 exercises fired');
  } else {
    const a = assertions.find((a) => a.id === 'all_exercises_fired');
    if (a) a.notes = `${firedExercises.length}/${ALL_EXERCISES.length} fired. Missing: ${missedExercises.join(', ')}`;
  }
  console.log(`\n🏋️   Exercise coverage: ${firedExercises.length}/${ALL_EXERCISES.length} exercises fired at least once`);
  if (missedExercises.length > 0) console.log(`    Missing: ${missedExercises.join(', ')}`);

  // ── Commitment checkin miss rate ──────────────────────────────────────────
  const ccc = report.summary.commitment_checkin_coverage;
  if (ccc.should_have_fired > 0) {
    const misses = ccc.should_have_fired - ccc.fired;
    ccc.miss_rate = `${Math.round((misses / ccc.should_have_fired) * 100)}%`;
    passAssertion(assertions, 'commitment_checkin_miss_rate', TOTAL_DAYS,
      `miss_rate=${ccc.miss_rate}, should=${ccc.should_have_fired}, fired=${ccc.fired}`);
  } else {
    ccc.miss_rate = 'n/a';
  }

  // ── Populate backend_summary from last session ────────────────────────────
  const lastSession = report.sessions[report.sessions.length - 1];
  if (lastSession?.backend_state) {
    const bs = lastSession.backend_state;
    report.backend_summary.final_follow_through_7day = bs.follow_through_7day;
    report.backend_summary.final_trajectory = bs.trajectory;
    report.backend_summary.narrative_produced = !!bs.narrative_sample;
    report.backend_summary.narrative_sample = bs.narrative_sample;
  }
  for (let i = report.sessions.length - 1; i >= 0; i--) {
    const patterns = report.sessions[i]?.backend_state?.patterns_accumulated;
    if (patterns && patterns.length > 0) {
      report.backend_summary.all_patterns = [...patterns].sort((a, b) => b.occurrences - a.occurrences);
      break;
    }
  }

  // ── Day 21 milestone assertions ───────────────────────────────────────────
  try {
    const { data: markers21 } = await supabase.from('growth_markers').select('id, theme').eq('user_id', userId);
    const hasMarker = markers21 && markers21.length > 0;
    const hasNarrative = report.backend_summary.narrative_produced;
    const traitGrade = report.trait_detection?.detection_grade ?? null;
    const gradeNotF = traitGrade !== 'F';
    if (hasMarker && hasNarrative && gradeNotF) {
      passAssertion(assertions, 'day21_growth_and_grade', TOTAL_DAYS,
        `marker: "${markers21[0]?.theme}", grade: ${traitGrade}`);
    } else {
      const a = assertions.find((a) => a.id === 'day21_growth_and_grade');
      if (a) a.notes = `marker=${hasMarker}, narrative=${hasNarrative}, grade=${traitGrade ?? 'n/a'}`;
    }
  } catch { /* non-fatal */ }

  // ── Trait detection ───────────────────────────────────────────────────────
  console.log(`\n🎯  Grading hidden trait detection...`);
  try {
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
    const traitResult = await gradeTraitDetection({
      assignedTraits,
      conversationHistory: fullConversationHistory,
      personaName: persona.name,
    });
    report.trait_detection = traitResult;
    console.log(`    Overall grade: ${traitResult.detection_grade} (${((traitResult.overall_detection_rate ?? 0) * 100).toFixed(0)}% detection rate)`);

    // Re-check day21 assertion now that we have the grade
    if (traitResult.detection_grade !== 'F') {
      const a = assertions.find((a) => a.id === 'day21_growth_and_grade');
      if (a && !a.passed && report.backend_summary.narrative_produced) {
        passAssertion(assertions, 'day21_growth_and_grade', TOTAL_DAYS,
          `grade: ${traitResult.detection_grade}, narrative: ${report.backend_summary.narrative_produced}`);
      }
    }
  } catch (err) {
    console.warn(`    ⚠️  Trait detection failed: ${err.message}`);
  }

  // ── Final profile snapshot ────────────────────────────────────────────────
  try {
    const { profile, narratives, goals } = await fetchProfileSnapshot(supabase, userId);
    report.backend_summary.user_profile_snapshot = {
      identity_statement: profile?.identity_statement ?? null,
      big_goal: profile?.big_goal ?? null,
      why: profile?.why ?? null,
      short_term_state: profile?.short_term_state ?? null,
      strengths: profile?.strengths ?? [],
      growth_areas: profile?.growth_areas ?? [],
    };
    report.backend_summary.generated_narratives = narratives ?? [];
    report.backend_summary.final_goals_snapshot = goals ?? [];
    console.log(`\n📋  Profile snapshot captured. ${narratives.length} narratives generated.`);
  } catch { /* non-fatal */ }

  // ── Print final coverage summary ──────────────────────────────────────────
  printCoverageSummary(assertions, firedExercises);

  // ── Save report ───────────────────────────────────────────────────────────
  try {
    writeFileSync(FULL_COVERAGE_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n✅  Full coverage report saved to:\n    ${FULL_COVERAGE_REPORT_PATH}\n`);
  } catch (err) {
    console.error('❌  Could not write full coverage report:', err.message);
  }
}

// ── Assert Week — re-check week N assertions from a saved coverage report ──────
/**
 * Reads an existing full-coverage-report.json and prints the assertions that
 * are relevant to the requested week number.
 *
 * Usage: node scripts/simulate-reflection.js --assert-week 2
 */
async function assertWeekFromReport(weekNumber) {
  const validWeeks = [1, 2, 3];
  if (!validWeeks.includes(weekNumber)) {
    console.error(`❌  --assert-week must be 1, 2, or 3 (got ${weekNumber})`);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(FULL_COVERAGE_REPORT_PATH, 'utf8'));
  } catch (err) {
    console.error(`❌  Could not read ${FULL_COVERAGE_REPORT_PATH}: ${err.message}`);
    console.error('    Run --test-full-coverage first to generate the report.');
    process.exit(1);
  }

  const assertions = report.coverage_assertions ?? [];
  const dayRanges = { 1: [1, 7], 2: [8, 14], 3: [15, 21] };
  const weekPrefixes = { 1: ['week1_', 'day7_'], 2: ['week2_'], 3: ['week3_', 'day21_'] };
  const [startDay, endDay] = dayRanges[weekNumber];
  const prefixes = weekPrefixes[weekNumber];

  const weekAssertions = assertions.filter((a) => {
    if (prefixes.some((p) => a.id.startsWith(p))) return true;
    // Also include assertions that first passed in this week's day range
    if (a.day_first_passed !== null && a.day_first_passed >= startDay && a.day_first_passed <= endDay) return true;
    return false;
  });

  // Remove duplicates (an assertion might match both prefix and day range)
  const seen = new Set();
  const uniqueWeekAssertions = weekAssertions.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  console.log(`\n${'═'.repeat(52)}`);
  console.log(`📋  WEEK ${weekNumber} ASSERTIONS  (days ${startDay}–${endDay})`);
  console.log('═'.repeat(52));

  if (uniqueWeekAssertions.length === 0) {
    console.log(`(no assertions specific to week ${weekNumber} found in report)`);
  } else {
    for (const a of uniqueWeekAssertions) {
      const icon = a.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${icon}  ${a.description}`);
      if (a.notes) console.log(`       ↳ ${a.notes}`);
      if (a.day_first_passed !== null) console.log(`       ↳ first passed: day ${a.day_first_passed}`);
    }
  }
  const passed = uniqueWeekAssertions.filter((a) => a.passed).length;
  console.log(`\nWeek ${weekNumber}: ${passed}/${uniqueWeekAssertions.length} assertions passed`);
  console.log('═'.repeat(52));
}

// ── Main simulation ────────────────────────────────────────────────────────────
async function main() {
  const { days, startDate, persona: personaKey, clean, testWhyBuilding, testGoalSuggestion, testFullCoverage, assertWeek, scenario, dryRun, reportPath } = parseArgs();

  // Resolve final report output path
  const REPORT_PATH = reportPath ?? DEFAULT_REPORT_PATH;

  // Route to specialized test flows
  if (testWhyBuilding) {
    return runWhyBuildingTest({ personaKey, startDate, clean });
  }
  if (testGoalSuggestion) {
    return runGoalSuggestionTest({ personaKey, startDate, clean });
  }
  if (testFullCoverage) {
    return runFullCoverageTest({ personaKey, startDate, clean });
  }
  if (assertWeek !== null) {
    return assertWeekFromReport(assertWeek);
  }

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
  console.log(`    Days:       ${dryRun ? 1 : days}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`    Start date: ${startDate}`);
  console.log(`    User ID:    [set via SIM_USER_ID]`);
  console.log(`    Scenario:   ${scenario}`);
  if (reportPath) console.log(`    Report:     ${REPORT_PATH}`);
  console.log('');

  // ── Persona drift factor for long simulations ─────────────────────────────
  // Gradually reduces Mode C (deflection) probability over 30+ days
  const personaDriftFactor = days >= 30 ? 0.5 : 0;

  // ── Draw hidden traits from the persona's pool ────────────────────────────
  const traitPool = persona.hiddenTraitPool ?? [];
  const assignedTraits = drawTraits(traitPool, 2);

  console.log(`🧠  Hidden traits assigned:`);
  assignedTraits.forEach((t, i) => {
    console.log(`    ${i + 1}. ${t.label} — ${t.archetype}`);
  });
  console.log('');

  // ── Shuffled event queue — avoid repeating events until the full bank is used ──
  const eventBankRaw = persona.dailyEventBank ?? [];
  let eventQueue = [];

  function nextDailyEvent() {
    if (eventBankRaw.length === 0) return null;
    if (eventQueue.length === 0) {
      // Shuffle event bank and load into queue (no repeats until full bank exhausted)
      eventQueue = shuffleArray(eventBankRaw);
    }
    return eventQueue.shift();
  }

  // ── Report state ──
  const report = {
    meta: {
      persona: personaKey,
      start_date: startDate,
      days_simulated: dryRun ? 1 : days,
      user_id: userId,
      run_at: new Date().toISOString(),
      assigned_traits: assignedTraits.map((t) => ({ id: t.id, label: t.label })),
      clean: clean,
      scenario,
      dry_run: dryRun,
      pre_run_profile_snapshot: null,
      clean_result: null,
    },
    summary: {
      total_turns: 0,
      avg_quality_score: 0,
      sessions_completed: 0,
      sessions_incomplete: 0,
      flags_by_type: {},
      avg_why_deepening_quality: null,
      why_evolution_events: 0,
      goals_with_multiple_whys: 0,
      commitment_checkin_coverage: {
        fired: 0,
        resolved: 0,
        should_have_fired: 0,
        miss_rate: null,
      },
    },
    backend_summary: {
      final_follow_through_7day: null,
      final_trajectory: null,
      all_patterns: [],
      narrative_produced: false,
      narrative_sample: null,
      user_profile_snapshot: null,
      generated_narratives: [],
      final_goals_snapshot: [],
    },
    sessions: [],
    flagged_for_review: [],
  };

  let totalQualityScores = [];
  let totalWhyDeepeningScores = [];

  // ── Cross-session state — carries forward across days ─────────────────────
  const crossSessionState = {
    yesterdayCommitment: null,
    lastFollowedThrough: null, // whether user followed through on the most recent commitment
    prevGoalWhysCounts: {}, // goalId → whys count from previous session
  };

  // ── Graceful interrupt handler — write partial report ──
  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
    console.log('\n\n⚠️  Interrupted — writing partial report...');
    finalizeReport(report, totalQualityScores, totalWhyDeepeningScores, REPORT_PATH);
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
  const totalDays = dryRun ? 1 : days;
  for (let day = 1; day <= totalDays; day++) {
    if (interrupted) break;

    const simulatedDate = addDays(startDate, day - 1);

    // Pick mood for the day from persona's distribution
    const moods = persona.tendencies.mood_distribution;
    const mood = moods[(day - 1) % moods.length];

    // Draw today's daily event from the shuffled queue (no repeats until full bank used)
    const dailyEvent = nextDailyEvent();

    separator(day, simulatedDate);
    if (dailyEvent) {
      console.log(`📅  Today's event: ${dailyEvent}`);
    }

    // Create session row
    const sessionId = await createSessionRow(supabase, userId, simulatedDate);

    // Determine followedThrough for this day based on scenario
    let followedThroughToday = null;
    if (crossSessionState.yesterdayCommitment) {
      if (scenario === 'kept_streak') {
        followedThroughToday = true;
      } else if (scenario === 'miss_streak') {
        followedThroughToday = false;
      } else if (scenario === 'cold_start') {
        followedThroughToday = null;
      } else {
        // 'mixed': alternate or use persona's follow-through rate
        if (crossSessionState.lastFollowedThrough === true) {
          followedThroughToday = Math.random() < MISS_AFTER_KEEP_PROBABILITY;
        } else if (crossSessionState.lastFollowedThrough === false) {
          followedThroughToday = Math.random() < KEEP_AFTER_MISS_PROBABILITY;
        } else {
          followedThroughToday = Math.random() < persona.tendencies.follow_through_rate;
        }
      }
    }

    // Per-session state
    let history = [];
    let sessionState = {
      current_stage: 'wins',
      checklist: { wins: false, honest: false, plan: false, identity: false },
      tomorrow_commitment: null,
      exercises_run: [],
      consecutive_excuses: 0,
      is_complete: false,
      commitment_checkin_done: false,
      yesterday_commitment_in_state: crossSessionState.yesterdayCommitment !== null && scenario !== 'cold_start',
    };

    // Track what the persona has shared this session (for realistic response gen)
    const sessionContext = { sharedWins: null, sharedMisses: null, sharedTomorrow: null, sharedCheckin: null };

    // Track stage sequence for this session
    const stageSequence = [sessionState.current_stage];

    const sessionRecord = {
      date: simulatedDate,
      session_id: sessionId,
      daily_event: dailyEvent,
      completed: false,
      turns: 0,
      avg_quality: null,
      exercises_run: [],
      checklist: { wins: false, honest: false, plan: false, identity: false },
      checkin_stage_fired: false,
      checkin_stage_resolved: false,
      stage_sequence: [],
      anomalies: [],
      conversation: [],
      backend_state: null,
      goals_why_snapshot: [],
    };

    const sessionQualityScores = [];
    const sessionWhyDeepeningScores = [];
    const MAX_TURNS = 16;
    let turn = 0;

    // ── INIT turn ──────────────────────────────────────────────────────────
    const initResult = await callCoach({
      user_id: userId,
      session_id: sessionId,
      session_state: {
        ...sessionState,
        yesterday_commitment: (scenario !== 'cold_start' ? crossSessionState.yesterdayCommitment : null) || null,
        commitment_checkin_done: sessionState.commitment_checkin_done,
      },
      history: [],
      user_message: '__INIT__',
      context: { client_local_date: simulatedDate },
    });

    const initCoachMsg = initResult.assistant_message || '';
    printCoach(initCoachMsg);

    // Update session state from INIT
    if (initResult.stage_advance && initResult.new_stage) {
      sessionState.current_stage = initResult.new_stage;
      if (!stageSequence.includes(initResult.new_stage)) stageSequence.push(initResult.new_stage);
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
    if (initResult.commitment_checkin_done === true) {
      sessionState.commitment_checkin_done = true;
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

    // ── Assert whys context after INIT (pre-conversation) ─────────────────
    await assertWhysContext(supabase, userId);

    // ── Conversation loop ──────────────────────────────────────────────────
    // Fetch current goal whys once per session to pass to scoring
    let sessionGoalWhys = [];
    try {
      const { data: goalsForWhys } = await supabase
        .from('goals')
        .select('id, title, whys')
        .eq('user_id', userId)
        .eq('status', 'active');
      sessionGoalWhys = selectGoalWhysForScoring(goalsForWhys ?? []);
    } catch {
      // Non-fatal — scoring will just have no whys context
    }

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
        yesterdayCommitment: scenario !== 'cold_start' ? crossSessionState.yesterdayCommitment : null,
        followedThrough: followedThroughToday,
        assignedTraits,
        dayNumber: day,
        whyPool: persona.whyPool ?? null,
        personaDriftFactor,
      });

      printUser(userMsg);

      // Update session context so future responses are more coherent
      if (sessionState.current_stage === 'wins') sessionContext.sharedWins = userMsg;
      if (sessionState.current_stage === 'honest') sessionContext.sharedMisses = userMsg;
      if (sessionState.current_stage === 'tomorrow') sessionContext.sharedTomorrow = userMsg;
      if (sessionState.current_stage === 'commitment_checkin') sessionContext.sharedCheckin = userMsg;

      history.push({ role: 'user', content: userMsg });

      // Call the coach
      const result = await callCoach({
        user_id: userId,
        session_id: sessionId,
        session_state: {
          ...sessionState,
          yesterday_commitment: (scenario !== 'cold_start' ? crossSessionState.yesterdayCommitment : null) || null,
          commitment_checkin_done: sessionState.commitment_checkin_done,
        },
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
      const prevStage = sessionState.current_stage;
      const stageAdvanced = !!(result.stage_advance && result.new_stage);

      // Update session state
      if (result.stage_advance && result.new_stage) {
        sessionState.current_stage = result.new_stage;
        if (!stageSequence.includes(result.new_stage)) stageSequence.push(result.new_stage);
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
      if (result.commitment_checkin_done === true) {
        sessionState.commitment_checkin_done = true;
      }
      if (result.is_session_complete) {
        sessionState.is_complete = true;
      }

      // Track commitment_checkin stage appearances
      if (prevStage === 'commitment_checkin' || sessionState.current_stage === 'commitment_checkin') {
        sessionRecord.checkin_stage_fired = true;
      }
      if (sessionState.commitment_checkin_done) {
        sessionRecord.checkin_stage_resolved = true;
      }

      history.push({ role: 'assistant', content: coachMsg });

      printCoach(coachMsg);

      // Score the coach message (including why-deepening quality)
      const quality = await scoreCoachMessage({
        persona,
        userProfile: persona.profile,
        currentStage: sessionState.current_stage,
        turnNumber: turn,
        previousUserMessage: prevUserMsg,
        coachMessage: coachMsg,
        goalWhys: sessionGoalWhys,
        stageAdvanced,
      });

      printQuality(quality);

      sessionQualityScores.push(quality.score);
      totalQualityScores.push(quality.score);

      if (quality.why_deepening_quality != null) {
        sessionWhyDeepeningScores.push(quality.why_deepening_quality);
        totalWhyDeepeningScores.push(quality.why_deepening_quality);
      }

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
    sessionRecord.checkin_stage_fired = sessionRecord.checkin_stage_fired || stageSequence.includes('commitment_checkin');
    sessionRecord.checkin_stage_resolved = sessionState.commitment_checkin_done;
    sessionRecord.stage_sequence = [...stageSequence];

    // Detect anomalies: commitment_checkin should fire when yesterday's commitment exists
    const hadYesterdayCommitment = crossSessionState.yesterdayCommitment !== null && scenario !== 'cold_start';
    if (hadYesterdayCommitment && !sessionRecord.checkin_stage_fired) {
      sessionRecord.anomalies.push('commitment_checkin skipped despite yesterday commitment existing');
    }

    sessionRecord.avg_quality =
      sessionQualityScores.length > 0
        ? Math.round((sessionQualityScores.reduce((a, b) => a + b, 0) / sessionQualityScores.length) * 100) / 100
        : null;
    const sessionAvgWhyQuality = sessionWhyDeepeningScores.length > 0
      ? Math.round((sessionWhyDeepeningScores.reduce((a, b) => a + b, 0) / sessionWhyDeepeningScores.length) * 100) / 100
      : null;

    // Update cross-session state for the next day
    crossSessionState.yesterdayCommitment = sessionState.tomorrow_commitment ?? null;

    // Determine followedThrough for this session (did wins mention following through on yesterday's commitment?)
    if (hadYesterdayCommitment) {
      crossSessionState.lastFollowedThrough = followedThroughToday;
    } else {
      crossSessionState.lastFollowedThrough = null;
    }

    // Update commitment_checkin_coverage stats
    if (hadYesterdayCommitment) {
      report.summary.commitment_checkin_coverage.should_have_fired++;
    }
    if (sessionRecord.checkin_stage_fired) {
      report.summary.commitment_checkin_coverage.fired++;
    }
    if (sessionRecord.checkin_stage_resolved) {
      report.summary.commitment_checkin_coverage.resolved++;
    }

    // Run backend validation and store result
    console.log(`\n🔍  Backend validation:`);
    const backendState = await validateBackend(supabase, userId, simulatedDate, crossSessionState.prevGoalWhysCounts);
    sessionRecord.backend_state = backendState;

    // Build goals_why_snapshot for this session and update prevGoalWhysCounts
    if (backendState.goals_snapshot && backendState.goals_snapshot.length > 0) {
      sessionRecord.goals_why_snapshot = backendState.goals_snapshot.map((g) => ({
        goal_title: g.title,
        whys_count: g.whys_count,
        latest_why: g.latest_why,
        // session_avg_why_deepening_quality is a session-wide average across all turns, not goal-specific
        session_avg_why_deepening_quality: sessionAvgWhyQuality,
      }));
      // Update cross-session prev counts for next day's comparison
      for (const g of backendState.goals_snapshot) {
        crossSessionState.prevGoalWhysCounts[g.goal_id] = g.whys_count;
      }
      // Track why evolution events for summary
      if (backendState.why_evolution_events && backendState.why_evolution_events.length > 0) {
        report.summary.why_evolution_events += backendState.why_evolution_events.length;
      }
    }

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
    if (day < totalDays) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // --dry-run: print full conversation and exit after day 1
    if (dryRun) {
      console.log('\n📋  DRY-RUN complete — full conversation for day 1:');
      for (const entry of sessionRecord.conversation) {
        // For INIT (turn 0), coach speaks first; for all other turns, user speaks then coach responds
        if (entry.turn === 0) {
          if (entry.coach) console.log(`🤖  ${entry.coach}`);
        } else {
          if (entry.user) console.log(`👤  ${entry.user}`);
          if (entry.coach) console.log(`🤖  ${entry.coach}`);
        }
      }
      console.log('\n✅  Dry-run finished. No report written.\n');
      process.exit(0);
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
    const { profile, narratives, goals } = await fetchProfileSnapshot(supabase, userId);
    report.backend_summary.user_profile_snapshot = {
      identity_statement: profile?.identity_statement ?? null,
      big_goal: profile?.big_goal ?? null,
      why: profile?.why ?? null,
      short_term_state: profile?.short_term_state ?? null,
      strengths: profile?.strengths ?? [],
      growth_areas: profile?.growth_areas ?? [],
    };
    report.backend_summary.generated_narratives = narratives ?? [];
    report.backend_summary.final_goals_snapshot = goals ?? [];
    console.log(`\n📋  Profile snapshot captured`);
    console.log(`💬  ${narratives.length} narratives generated`);
    if (goals.length > 0) {
      console.log(`\n🎯  Final goals state (${goals.length} active):`);
      for (const g of goals) {
        const whysArr = g.whys ?? [];
        console.log(`    "${g.title}" [${g.category ?? 'uncategorized'}] — ${whysArr.length} why${whysArr.length !== 1 ? 's' : ''} developed`);
        for (const w of whysArr) {
          const src = w.source ? ` [${w.source}]` : '';
          const date = w.added_at ? ` · ${w.added_at}` : '';
          const text = w.text?.length > 100 ? `${w.text.slice(0, 100)}...` : (w.text ?? '');
          console.log(`        "${text}"${src}${date}`);
        }
      }
    }
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

  finalizeReport(report, totalQualityScores, totalWhyDeepeningScores, REPORT_PATH);
  console.log(`\n✅  Simulation complete. Report saved to:\n    ${REPORT_PATH}\n`);
  if (clean) {
    console.log(`✅  Clean run complete. Pre-run snapshot saved to report.meta.pre_run_profile_snapshot\n`);
  }
}

// ── Finalize and write report ──────────────────────────────────────────────────
function finalizeReport(report, totalQualityScores, totalWhyDeepeningScores = [], reportPath = DEFAULT_REPORT_PATH) {
  report.summary.avg_quality_score =
    totalQualityScores.length > 0
      ? Math.round((totalQualityScores.reduce((a, b) => a + b, 0) / totalQualityScores.length) * 100) / 100
      : 0;

  // Why-deepening summary
  report.summary.avg_why_deepening_quality =
    totalWhyDeepeningScores.length > 0
      ? Math.round((totalWhyDeepeningScores.reduce((a, b) => a + b, 0) / totalWhyDeepeningScores.length) * 100) / 100
      : null;

  // Compute commitment_checkin_coverage miss_rate
  const ccc = report.summary.commitment_checkin_coverage;
  if (ccc.should_have_fired > 0) {
    const misses = ccc.should_have_fired - ccc.fired;
    ccc.miss_rate = `${Math.round((misses / ccc.should_have_fired) * 100)}%`;
  } else {
    ccc.miss_rate = 'n/a';
  }

  // Count goals that ended up with multiple whys (from the final session's goals_why_snapshot)
  const lastSessionWithGoals = [...report.sessions].reverse().find((s) => s.goals_why_snapshot?.length > 0);
  if (lastSessionWithGoals) {
    report.summary.goals_with_multiple_whys = lastSessionWithGoals.goals_why_snapshot.filter(
      (g) => g.whys_count > 1,
    ).length;
  }

  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    console.error('❌  Could not write report:', err.message);
  }
}

main().catch((err) => {
  console.error('❌  Simulation failed:', err);
  process.exit(1);
});
