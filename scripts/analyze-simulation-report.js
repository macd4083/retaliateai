import { readFileSync } from 'fs';
import path from 'path';
import process from 'process';

const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), 'scripts', 'simulation-report.json');
const MINIMUM_FIRST_KEYWORDS = ['minimum', 'floor', 'at least', 'guarantee', 'what you know you can'];
const HONEST_FORWARD_ACTION_PATTERNS = [
  'small step',
  'next step',
  'what can you do',
  'what will you do',
  'how will you',
  'what would you do differently',
  "what's one thing you could do",
  "what's one thing you can",
  'align more with',
  'moving forward',
  'going forward',
  'what would help you',
  'action you can take',
  'step you can take',
  'step toward',
  'plan for tomorrow',
  'do tomorrow',
];

function parseArgs(argv) {
  let filePath = DEFAULT_REPORT_PATH;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) {
      filePath = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage:');
      console.log('  node scripts/analyze-simulation-report.js');
      console.log('  node scripts/analyze-simulation-report.js --file scripts/my-report.json');
      process.exit(0);
    }
  }

  return { filePath };
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`❌  Could not read report file: ${filePath}`);
    console.error(`    ${error.message}`);
    process.exit(1);
  }
}

function getSessions(report) {
  if (Array.isArray(report?.sessions)) return report.sessions;
  if (Array.isArray(report)) return report;
  return [];
}

function hasKeyword(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function scanHonestForwardAction(coachMessage) {
  const normalized = String(coachMessage || '').toLowerCase();
  const matchedPatterns = HONEST_FORWARD_ACTION_PATTERNS.filter((pattern) => normalized.includes(pattern));

  return {
    leak: matchedPatterns.length > 0,
    flags: matchedPatterns.map((pattern) => `HONEST_FORWARD_ACTION_LEAK: matched pattern '${pattern}'`),
  };
}

function deriveStageSequence(session, conversation) {
  if (Array.isArray(session?.session_summary?.stage_sequence)) return session.session_summary.stage_sequence;
  if (Array.isArray(session?.stage_sequence) && session.stage_sequence.length > 0) return session.stage_sequence;

  const seen = new Set();
  const sequence = [];
  for (const entry of conversation) {
    if (entry?.stage && !seen.has(entry.stage)) {
      seen.add(entry.stage);
      sequence.push(entry.stage);
    }
    if (entry?.stage_after && !seen.has(entry.stage_after)) {
      seen.add(entry.stage_after);
      sequence.push(entry.stage_after);
    }
  }
  return sequence;
}

function deriveStageTransitions(session, conversation) {
  if (Array.isArray(session?.session_summary?.stage_transitions)) return session.session_summary.stage_transitions;
  if (Array.isArray(session?.stage_transitions)) return session.stage_transitions;

  return conversation
    .filter((entry) => entry?.stage_advanced === true && entry?.new_stage)
    .map((entry) => ({
      turn: entry.turn,
      from_stage: entry.stage || null,
      to_stage: entry.new_stage,
      user_message: entry.user || null,
      coach_message: entry.coach || null,
      directive_completed: entry.directive_completed || null,
      honest_depth_at_transition: entry.honest_depth === true,
      checklist_at_transition: entry.checklist_after || null,
    }));
}

function buildLeakDetails(conversation) {
  return conversation
    .map((entry) => {
      if (entry?.stage !== 'honest') return null;
      if (entry?.honest_forward_action_leak === true) {
        return {
          turn: entry.turn,
          coach: entry.coach || '',
          flags: Array.isArray(entry.honest_forward_action_flags) ? entry.honest_forward_action_flags : [],
        };
      }

      const scanned = scanHonestForwardAction(entry?.coach || '');
      if (!scanned.leak) return null;

      return {
        turn: entry.turn,
        coach: entry.coach || '',
        flags: scanned.flags,
      };
    })
    .filter(Boolean);
}

function buildDirectivesFired(session, conversation) {
  if (Array.isArray(session?.session_summary?.directives_fired)) return session.session_summary.directives_fired;

  return conversation
    .filter((entry) => entry?.directive_completed)
    .map((entry) => ({
      turn: entry.turn,
      stage: entry.stage || null,
      directive: entry.directive_completed,
    }));
}

function formatTurnRanges(turns) {
  if (!turns.length) return 'none';

  const sortedTurns = [...new Set(turns)].sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = sortedTurns[0];
  let previous = sortedTurns[0];

  for (let i = 1; i < sortedTurns.length; i++) {
    const current = sortedTurns[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}–${previous}`);
    rangeStart = current;
    previous = current;
  }

  ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}–${previous}`);
  return ranges.join(', ');
}

function formatQuote(text, indent = '  ') {
  if (!text) return `${indent}(none)`;
  return `${indent}"${String(text).trim()}"`;
}

function buildSessionSummary(session, index) {
  const conversation = Array.isArray(session?.conversation) ? session.conversation : [];
  const stageSequence = deriveStageSequence(session, conversation);
  const stageTransitions = deriveStageTransitions(session, conversation);
  const honestLeakDetails = buildLeakDetails(conversation);
  const firstTomorrowEntry = conversation.find((entry) => entry?.stage === 'tomorrow') || null;
  const honestToTomorrowTransition = stageTransitions.find(
    (transition) => transition?.from_stage === 'honest' && transition?.to_stage === 'tomorrow',
  ) || null;
  const honestTurns = conversation.filter((entry) => entry?.stage === 'honest').map((entry) => entry.turn);
  const tomorrowTurns = conversation.filter((entry) => entry?.stage === 'tomorrow').map((entry) => entry.turn);
  const providedSummary = session?.session_summary || {};

  return {
    label: `Day ${session?.day ?? index + 1}`,
    date: session?.date || '(unknown date)',
    total_turns: providedSummary.total_turns ?? session?.turns ?? conversation.filter((entry) => entry?.turn > 0).length,
    stage_sequence: stageSequence,
    stage_transitions: stageTransitions,
    honest_stage_turns: providedSummary.honest_stage_turns ?? honestTurns.length,
    tomorrow_stage_turns: providedSummary.tomorrow_stage_turns ?? tomorrowTurns.length,
    honest_turn_ranges: formatTurnRanges(honestTurns),
    tomorrow_turn_ranges: formatTurnRanges(tomorrowTurns),
    honest_forward_action_violations:
      providedSummary.honest_forward_action_violations ?? honestLeakDetails.length,
    honest_forward_action_details:
      providedSummary.honest_forward_action_details ?? honestLeakDetails,
    first_tomorrow_message: providedSummary.first_tomorrow_message ?? firstTomorrowEntry?.coach ?? null,
    first_tomorrow_turn: providedSummary.first_tomorrow_turn ?? firstTomorrowEntry?.turn ?? null,
    honest_to_tomorrow_transition: providedSummary.honest_to_tomorrow_transition ?? honestToTomorrowTransition,
    honest_depth_before_tomorrow:
      providedSummary.honest_depth_before_tomorrow
      ?? (honestToTomorrowTransition ? honestToTomorrowTransition.honest_depth_at_transition === true : null),
    directives_fired: buildDirectivesFired(session, conversation),
    is_complete: providedSummary.is_complete ?? session?.completed ?? false,
    commitment_minimum: providedSummary.commitment_minimum ?? session?.commitment_minimum ?? null,
    commitment_stretch: providedSummary.commitment_stretch ?? session?.commitment_stretch ?? null,
    tomorrow_commitment: providedSummary.tomorrow_commitment ?? session?.commitment_made ?? null,
  };
}

function printSessionAnalysis(summary) {
  const stageSequenceText = summary.stage_sequence.length > 0 ? summary.stage_sequence.join(' → ') : '(unknown)';
  const minimumFirst = hasKeyword(summary.first_tomorrow_message, MINIMUM_FIRST_KEYWORDS);
  const forwardActionOnly =
    hasKeyword(summary.first_tomorrow_message, HONEST_FORWARD_ACTION_PATTERNS) && !minimumFirst;

  console.log('═══════════════════════════════════════');
  console.log(`SESSION ${summary.label} — ${summary.date}`);
  console.log(`Stage sequence: ${stageSequenceText}`);
  console.log(`Total turns: ${summary.total_turns}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  console.log('STAGE TRANSITIONS:');
  if (summary.stage_transitions.length === 0) {
    console.log('  (none recorded)');
  } else {
    for (const transition of summary.stage_transitions) {
      const extras = [];
      if (transition?.directive_completed) extras.push(`directive: ${transition.directive_completed}`);
      if (transition?.honest_depth_at_transition != null) {
        const value = transition.honest_depth_at_transition === true ? 'TRUE ✅' : 'false';
        extras.push(`honest_depth_at_transition: ${value}`);
      }
      const suffix = extras.length ? ` (${extras.join(' | ')})` : '';
      console.log(
        `  Turn ${transition.turn}:  ${transition.from_stage ?? '(unknown)'} → ${transition.to_stage ?? '(unknown)'}${suffix}`,
      );
    }
  }
  console.log('');

  console.log('HONEST STAGE ANALYSIS:');
  console.log(`  Turns in honest stage: ${summary.honest_stage_turns} (${summary.honest_turn_ranges})`);
  console.log(
    `  Forward-action leaks: ${summary.honest_forward_action_violations}${summary.honest_forward_action_violations === 0 ? ' ✅' : ''}`,
  );
  for (const detail of summary.honest_forward_action_details) {
    const matched = Array.isArray(detail.flags) && detail.flags.length > 0 ? detail.flags.join('; ') : 'matched: unknown';
    console.log(`  VIOLATION at turn ${detail.turn}: ${JSON.stringify(detail.coach)} — ${matched}`);
  }
  console.log('');

  console.log('TOMORROW STAGE ANALYSIS:');
  if (!summary.first_tomorrow_message) {
    console.log('  First tomorrow message: (none)');
  } else {
    console.log(`  First tomorrow message (turn ${summary.first_tomorrow_turn}):`);
    console.log(formatQuote(summary.first_tomorrow_message, '  '));
  }
  console.log(`  Contains 'minimum': ${minimumFirst ? 'YES ✅' : 'NO'}`);
  console.log(`  Contains forward-action only language: ${forwardActionOnly ? 'YES' : 'NO ✅'}`);
  console.log('');

  console.log('DIRECTIVES FIRED THIS SESSION:');
  if (summary.directives_fired.length === 0) {
    console.log('  (none recorded)');
  } else {
    for (const directive of summary.directives_fired) {
      console.log(
        `  Turn ${directive.turn}  [${directive.stage ?? 'unknown'}]   ${directive.directive}`,
      );
    }
  }
  console.log('');
}

function printOverallSummary(summaries) {
  const totalSessions = summaries.length;
  const sessionsWithoutLeaks = summaries.filter((summary) => summary.honest_forward_action_violations === 0).length;
  const sessionsWithDepthAtTransition = summaries.filter((summary) => summary.honest_depth_before_tomorrow === true).length;
  const minimumFirstCount = summaries.filter((summary) => hasKeyword(summary.first_tomorrow_message, MINIMUM_FIRST_KEYWORDS)).length;
  const completedCount = summaries.filter((summary) => summary.is_complete === true).length;
  const minimumFirstRate = totalSessions > 0 ? Math.round((minimumFirstCount / totalSessions) * 100) : 0;

  console.log(`OVERALL SUMMARY (${totalSessions} session${totalSessions === 1 ? '' : 's'})`);
  console.log('─────────────────────────────────────────');
  console.log(
    `Honest forward-action leaks:    ${sessionsWithoutLeaks} / ${totalSessions} sessions${sessionsWithoutLeaks === totalSessions ? ' ✅' : ''}`,
  );
  console.log(
    `Honest→tomorrow w/ depth:       ${sessionsWithDepthAtTransition} / ${totalSessions} sessions${sessionsWithDepthAtTransition === totalSessions ? ' ✅' : ''}`,
  );
  console.log(
    `First tomorrow Qs minimum-first: ${minimumFirstCount} / ${totalSessions} sessions (${minimumFirstRate}%)`,
  );
  console.log(`Sessions completed:             ${completedCount} / ${totalSessions}`);
}

function main() {
  const { filePath } = parseArgs(process.argv.slice(2));
  const report = readJson(filePath);
  const sessions = getSessions(report);

  if (sessions.length === 0) {
    console.error(`❌  No sessions found in report: ${filePath}`);
    process.exit(1);
  }

  const summaries = sessions.map((session, index) => buildSessionSummary(session, index));
  for (const summary of summaries) {
    printSessionAnalysis(summary);
  }

  printOverallSummary(summaries);
}

main();
