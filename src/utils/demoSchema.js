import {
  Layout,
  MessageSquare,
  MousePointer,
  Navigation,
  Sparkles,
  Type,
} from 'lucide-react';

export const EASING_OPTIONS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring'];

export const STEP_TYPES = [
  {
    id: 'highlight',
    label: 'Highlight',
    icon: Sparkles,
    description: 'Focus attention on an element',
  },
  {
    id: 'tooltip',
    label: 'Tooltip',
    icon: MessageSquare,
    description: 'Show contextual guidance',
  },
  {
    id: 'modal',
    label: 'Modal',
    icon: Layout,
    description: 'Display full-screen announcement',
  },
  {
    id: 'pointer',
    label: 'Pointer',
    icon: MousePointer,
    description: 'Animate pointer on the canvas',
  },
  {
    id: 'cursor-path',
    label: 'Cursor Path',
    icon: Navigation,
    description: 'Move cursor through multiple points',
  },
  {
    id: 'text',
    label: 'Text',
    icon: Type,
    description: 'Display instruction text anywhere',
  },
];

export const stepTypeDefaults = {
  highlight: {
    color: '#ef4444',
    borderRadius: 8,
    padding: 8,
    pulse: true,
  },
  tooltip: {
    text: 'Explain this part of the workflow.',
    position: 'bottom',
    arrow: true,
  },
  modal: {
    title: 'Important update',
    body: 'Walk your users through the next action with a focused message.',
    cta: 'Continue',
    ctaAction: 'next',
    ctaUrl: '',
  },
  pointer: {
    x: 50,
    y: 50,
    size: 36,
    pointerColor: '#ef4444',
    animation: 'pulse',
  },
  'cursor-path': {
    points: [
      { x: 25, y: 40 },
      { x: 55, y: 55 },
      { x: 75, y: 35 },
    ],
    showTrail: true,
  },
  text: {
    content: 'Add guidance copy here.',
    textX: 50,
    textY: 20,
    style: 'card',
  },
};

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDemoStep(type = 'highlight', overrides = {}) {
  const normalizedType = stepTypeDefaults[type] ? type : 'highlight';

  const baseStep = {
    id: randomId(),
    label: `${STEP_TYPES.find((item) => item.id === normalizedType)?.label ?? 'Step'}`,
    type: normalizedType,
    selector: normalizedType === 'highlight' || normalizedType === 'tooltip' ? 'body' : null,
    duration: 3000,
    delay: 0,
    easing: 'easeInOut',
    advance: 'auto',
    config: { ...stepTypeDefaults[normalizedType] },
  };

  return {
    ...baseStep,
    ...overrides,
    config: {
      ...baseStep.config,
      ...(overrides.config || {}),
    },
  };
}

export function createDemoProject(overrides = {}) {
  const now = new Date().toISOString();
  const baseProject = {
    id: randomId(),
    name: 'Untitled Demo',
    description: '',
    snapshotUrl: null,
    snapshotHTML: null,
    viewport: {
      width: 1280,
      height: 800,
    },
    steps: [createDemoStep('highlight', { label: 'Step 1: Highlight' })],
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...baseProject,
    ...overrides,
    viewport: {
      ...baseProject.viewport,
      ...(overrides.viewport || {}),
    },
    steps: Array.isArray(overrides.steps)
      ? overrides.steps.map((step) => createDemoStep(step.type, step))
      : baseProject.steps,
    updatedAt: now,
  };
}
