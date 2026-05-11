export const LIVE_DEMO_DATA_KEY = 'retaliateai_live_demo_data';
export const LIVE_DEMO_SCRIPT_KEY = 'retaliateai_live_demo_script';
export const LIVE_DEMO_CHANNEL_NAME = 'retaliateai-live-demo';

export const LIVE_DEMO_STAGE_LABELS = {
  commitment_checkin: 'Check-in',
  wins: 'Wins',
  honest: 'Honest',
  tomorrow: 'Tomorrow',
};

function isValidLiveDemoStage(stage) {
  return typeof stage === 'string' && Boolean(LIVE_DEMO_STAGE_LABELS[stage]);
}

export const DEFAULT_LIVE_DEMO_SCRIPT = {
  checklist: [
    { label: 'Send two messages to potential users', checked: false },
    { label: 'Set up one user conversation', checked: false },
  ],
  turns: [
    { role: 'coach', content: 'Hey — how are you feeling tonight?', stage: 'wins' },
    { role: 'user', content: 'honestly pretty decent. had a solid day' },
    { role: 'coach', content: 'Nice. What made it solid?' },
    { role: 'user', content: 'I finally got back to working on my app after like 2 weeks of avoiding it. got a decent chunk done' },
    { role: 'coach', content: 'Two weeks of avoiding it and you got back in. What broke the pattern today?' },
    { role: 'user', content: 'idk I just told myself to do 20 minutes and it turned into 2 hours' },
    { role: 'coach', content: "That's the move. What else went well?" },
    { role: 'user', content: 'not much else honestly. rest of the day was pretty meh' },
    {
      role: 'coach',
      content: "Okay. Is there a part of today you're being honest with yourself about — something that didn't go the way it should have?",
      stage: 'honest',
    },
    { role: 'user', content: "yeah. I said I'd reach out to 3 potential users this week. haven't done any of it" },
    { role: 'coach', content: "What's actually in the way — not the surface reason, but what's underneath it?" },
    { role: 'user', content: "I think I'm scared they'll say the idea is bad. like as long as I don't ask I can still tell myself it might work" },
    {
      role: 'coach',
      content: "That's the real one. Avoiding feedback is protecting the idea more than building it. What's the minimum you're committing to tomorrow — not what you hope to do, what you will do?",
      stage: 'tomorrow',
    },
    {
      role: 'user',
      content: "one user conversation. I'll message two people tonight so it's already in motion",
      checkItem: [0, 1],
    },
    { role: 'coach', content: "That's a real commitment. Which goal does that connect to most?" },
    { role: 'user', content: "building something people actually want. I can't know that without talking to them" },
    { role: 'coach', content: "Exactly. You already know what needs to happen — tonight you're making sure tomorrow it does. Good session." },
  ],
};

function normalizeChecklistItem(item) {
  if (typeof item === 'string') {
    const label = item.trim();
    return label ? { label, checked: false } : null;
  }

  if (item && typeof item === 'object') {
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) return null;
    return {
      label,
      checked: Boolean(item.checked),
    };
  }

  return null;
}

function normalizeCheckDirective(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeCheckDirective);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return [{ index: value, checked: true }];
  if (typeof value === 'string' && value.trim()) return [{ label: value.trim(), checked: true }];
  if (value && typeof value === 'object') {
    const directive = {
      checked: typeof value.checked === 'boolean' ? value.checked : true,
    };
    if (typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0) {
      directive.index = value.index;
    }
    if (typeof value.label === 'string' && value.label.trim()) {
      directive.label = value.label.trim();
    }
    if (directive.index !== undefined || directive.label) return [directive];
  }
  return [];
}

export function normalizeLiveDemoScript(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.turns)) {
    const stageOrder = Array.isArray(parsed.stageOrder)
      ? parsed.stageOrder.filter(isValidLiveDemoStage)
      : undefined;

    const checklist = parsed.checklist
      ?.map(normalizeChecklistItem)
      .filter(Boolean) ?? [];

    const turns = parsed.turns
      .map((turn) => ({
        role: turn?.role === 'coach' ? 'coach' : turn?.role === 'user' ? 'user' : null,
        content: typeof turn?.content === 'string' ? turn.content : '',
        stage: isValidLiveDemoStage(turn?.stage) ? turn.stage : undefined,
        checkItem: turn?.checkItem,
      }))
      .filter((turn) => turn.role && turn.content);

    return {
      ...(stageOrder && stageOrder.length > 0 ? { stageOrder } : {}),
      checklist,
      turns: turns.length > 0 ? turns : DEFAULT_LIVE_DEMO_SCRIPT.turns,
    };
  }

  if (Array.isArray(parsed)) {
    const turns = parsed
      .map((turn) => ({
        role: turn?.role === 'coach' ? 'coach' : turn?.role === 'user' ? 'user' : null,
        content: typeof turn?.content === 'string' ? turn.content : '',
        stage: isValidLiveDemoStage(turn?.stage) ? turn.stage : undefined,
        checkItem: turn?.checkItem,
      }))
      .filter((turn) => turn.role && turn.content);

    return {
      checklist: DEFAULT_LIVE_DEMO_SCRIPT.checklist,
      turns: turns.length > 0 ? turns : DEFAULT_LIVE_DEMO_SCRIPT.turns,
    };
  }

  return DEFAULT_LIVE_DEMO_SCRIPT;
}

export function getLiveDemoStages(script) {
  if (Array.isArray(script?.stageOrder) && script.stageOrder.length > 0) {
    return script.stageOrder
      .filter(isValidLiveDemoStage)
      .map((id) => ({ id, label: LIVE_DEMO_STAGE_LABELS[id] }));
  }

  const seen = new Set();
  const stages = [];

  (script?.turns ?? []).forEach((turn) => {
    if (!turn?.stage || seen.has(turn.stage)) return;
    seen.add(turn.stage);
    stages.push({ id: turn.stage, label: LIVE_DEMO_STAGE_LABELS[turn.stage] ?? turn.stage });
  });

  return stages.length > 0
    ? stages
    : Object.entries(LIVE_DEMO_STAGE_LABELS).map(([id, label]) => ({ id, label }));
}

export function getLiveDemoInitialStage(script) {
  return getLiveDemoStages(script)[0]?.id ?? 'commitment_checkin';
}

export function buildLiveDemoChecklist(script, completedTurnCount = 0) {
  const checklist = (script?.checklist ?? [])
    .map((item) => (item ? { ...item } : null))
    .filter(Boolean);

  const turns = Array.isArray(script?.turns) ? script.turns.slice(0, completedTurnCount) : [];

  const upsertChecklistItem = (directive) => {
    const nextChecked = directive.checked ?? true;

    if (directive.index !== undefined) {
      const existing = checklist[directive.index];
      checklist[directive.index] = {
        label: directive.label ?? existing?.label ?? `Checklist item ${directive.index + 1}`,
        checked: nextChecked,
      };
      return;
    }

    const existingIndex = checklist.findIndex((item) => item.label === directive.label);
    if (existingIndex >= 0) {
      checklist[existingIndex] = { ...checklist[existingIndex], checked: nextChecked };
      return;
    }

    if (directive.label) {
      checklist.push({ label: directive.label, checked: nextChecked });
    }
  };

  turns.forEach((turn) => {
    normalizeCheckDirective(turn?.checkItem).forEach(upsertChecklistItem);
  });

  return checklist;
}

export function getLiveDemoStageForTurn(script, turnIndex) {
  const turns = Array.isArray(script?.turns) ? script.turns : [];
  const stageTurn = turns.slice(0, turnIndex + 1).reverse().find((turn) => turn?.stage);
  return stageTurn?.stage ?? getLiveDemoInitialStage(script);
}

export function normalizeLiveDemoData(data) {
  const scoreNum = Number(data?.commitmentScore);

  return {
    goals: Array.isArray(data?.goals)
      ? data.goals
          .map((goal) => ({
            title: typeof goal?.title === 'string' ? goal.title.trim() : '',
            why: typeof goal?.why === 'string' ? goal.why.trim() : '',
          }))
          .filter((goal) => goal.title)
      : [],
    commitmentScore:
      data?.commitmentScore !== '' && Number.isFinite(scoreNum) && scoreNum >= 0 && scoreNum <= 100
        ? scoreNum
        : null,
    weeklyScores: Array.from({ length: 7 }, (_, i) => {
      const d = Array.isArray(data?.weeklyScores) ? data.weeklyScores[i] : null;
      return {
        score:
          Number.isFinite(Number(d?.score)) && Number(d.score) >= 0 && Number(d.score) <= 100
            ? Number(d.score)
            : null,
        status: ['kept', 'missed', 'pending'].includes(d?.status) ? d.status : null,
      };
    }),
    streak:
      Number.isFinite(Number(data?.streak)) && Number(data.streak) >= 0
        ? Math.round(Number(data.streak))
        : 0,
    yesterdayCommitment: data?.yesterdayCommitment?.text
      ? {
          text: String(data.yesterdayCommitment.text).trim(),
          status: ['kept', 'missed', 'pending'].includes(data.yesterdayCommitment.status)
            ? data.yesterdayCommitment.status
            : 'pending',
          minimum:
            typeof data.yesterdayCommitment.minimum === 'string'
              ? data.yesterdayCommitment.minimum.trim()
              : '',
          stretch:
            typeof data.yesterdayCommitment.stretch === 'string'
              ? data.yesterdayCommitment.stretch.trim()
              : '',
        }
      : null,
    keptFragments: Array.isArray(data?.keptFragments)
      ? data.keptFragments
          .filter((f) => f?.text?.trim())
          .map((f) => ({
            text: String(f.text).trim(),
            goalTitle: typeof f.goalTitle === 'string' ? f.goalTitle.trim() : '',
            goalWhy: typeof f.goalWhy === 'string' ? f.goalWhy.trim() : '',
          }))
      : [],
    missedFragments: Array.isArray(data?.missedFragments)
      ? data.missedFragments
          .filter((f) => f?.text?.trim())
          .map((f) => ({
            text: String(f.text).trim(),
            goalTitle: typeof f.goalTitle === 'string' ? f.goalTitle.trim() : '',
            goalWhy: typeof f.goalWhy === 'string' ? f.goalWhy.trim() : '',
          }))
      : [],
  };
}

export function readLiveDemoScript() {
  if (typeof window === 'undefined') return DEFAULT_LIVE_DEMO_SCRIPT;

  try {
    const raw = window.localStorage.getItem(LIVE_DEMO_SCRIPT_KEY);
    if (!raw) return DEFAULT_LIVE_DEMO_SCRIPT;
    return normalizeLiveDemoScript(JSON.parse(raw));
  } catch {
    return DEFAULT_LIVE_DEMO_SCRIPT;
  }
}

export function readLiveDemoData() {
  if (typeof window === 'undefined') return normalizeLiveDemoData(null);

  try {
    const raw = window.localStorage.getItem(LIVE_DEMO_DATA_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeLiveDemoData(parsed);
  } catch {
    return normalizeLiveDemoData(null);
  }
}
