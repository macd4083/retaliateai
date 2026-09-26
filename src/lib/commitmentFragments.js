export function splitCommitmentText(text) {
  if (!text || !String(text).trim()) return [];
  const normalized = String(text).trim();
  const seedParts = normalized
    .split(/\.\s+(?=[A-Z])|;\s*|,\s*(?:and|or)\s+/i)
    .map((value) => value.replace(/\.\s*$/, '').trim())
    .filter(Boolean);
  const parts = seedParts.flatMap((value) => splitConjunctionTaskClauses(value));
  return parts.length > 0 ? parts : [normalized];
}

const TASK_START_REGEX = /^(send|write|call|ship|build|review|test|draft|publish|exercise|train|prepare|finish|email|create|record|deliver|update|refactor|fix)\b/i;

function splitConjunctionTaskClauses(input) {
  const segment = String(input || '').trim();
  if (!segment) return [];

  const matches = segment.match(/\s+(?:and|or)\s+/gi);
  if (!matches) return [segment];

  const tokens = segment.split(/\s+(?:and|or)\s+/i).map((value) => value.trim()).filter(Boolean);
  if (tokens.length !== 2) return [segment];

  const [left, right] = tokens;
  if (!TASK_START_REGEX.test(right)) return [segment];
  if (left.split(/\s+/).length < 2) return [segment];
  return [left, right];
}

function extractTypedTextFromCombinedCommitment(tomorrowCommitment) {
  const text = String(tomorrowCommitment || '').trim();
  if (!text) return { minimum: '', stretch: '', fallback: '' };

  const labels = [];
  const minimumMatch = /minimum\s*:/i.exec(text);
  const stretchMatch = /stretch\s*:/i.exec(text);
  if (minimumMatch) labels.push({ type: 'minimum', index: minimumMatch.index, length: minimumMatch[0].length });
  if (stretchMatch) labels.push({ type: 'stretch', index: stretchMatch.index, length: stretchMatch[0].length });
  if (!labels.length) return { minimum: '', stretch: '', fallback: text };

  labels.sort((a, b) => a.index - b.index);
  const extracted = { minimum: '', stretch: '', fallback: '' };

  if (labels[0].index > 0) {
    extracted.fallback = text.slice(0, labels[0].index).trim().replace(/^[-–:\s]+/, '');
  }

  labels.forEach((label, index) => {
    const start = label.index + label.length;
    const end = index + 1 < labels.length ? labels[index + 1].index : text.length;
    extracted[label.type] = text.slice(start, end).trim().replace(/^[-–:\s]+/, '');
  });

  return extracted;
}

export function buildCommitmentFragmentsFromLegacyFields({
  tomorrowCommitment,
  commitmentMinimum,
  commitmentStretch,
}) {
  const combined = extractTypedTextFromCombinedCommitment(tomorrowCommitment);
  const minimumSource = String(commitmentMinimum || '').trim() || combined.minimum;
  const stretchSource = String(commitmentStretch || '').trim() || combined.stretch;

  const minimumParts = splitCommitmentText(minimumSource);
  const stretchParts = splitCommitmentText(stretchSource);
  const fragments = [
    ...minimumParts.map((text) => ({ text, type: 'minimum' })),
    ...stretchParts.map((text) => ({ text, type: 'stretch' })),
  ];

  if (fragments.length > 0) return fragments;

  const fallbackSource = combined.fallback || String(tomorrowCommitment || '').trim();
  return splitCommitmentText(fallbackSource).map((text) => ({ text, type: null }));
}

export function formatCommitmentFragmentText(fragment) {
  if (fragment?.type === 'minimum') return `Minimum: ${fragment.text}`;
  if (fragment?.type === 'stretch') return `Stretch: ${fragment.text}`;
  return fragment?.text || '';
}
