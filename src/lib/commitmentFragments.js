export function splitCommitmentIntoTasks(text) {
  if (!text || !String(text).trim()) return [];

  const parts = String(text)
    .split(/\.\s+(?=[A-Z])|;\s*|,\s*(?:and|or)\s+|\s+(?:and|or)\s+/i)
    .map((s) => s.replace(/\.\s*$/, '').trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [String(text).trim()];
}

export function buildCommitmentFragments({ tomorrowCommitment, commitmentMinimum, commitmentStretch }) {
  const minimum = String(commitmentMinimum || '').trim();
  const stretch = String(commitmentStretch || '').trim();
  const commitment = String(tomorrowCommitment || '').trim();

  const minimumTasks = splitCommitmentIntoTasks(minimum);
  const stretchTasks = splitCommitmentIntoTasks(stretch);
  const allTasks = [...minimumTasks, ...stretchTasks];

  if (allTasks.length === 0 && commitment) {
    const fallbackTasks = splitCommitmentIntoTasks(commitment);
    return fallbackTasks.map((task, i) => ({
      commitment_text: task,
      fragment_index: i,
      commitment_type: null,
    }));
  }

  return [
    ...minimumTasks.map((task, i) => ({
      commitment_text: task,
      fragment_index: i,
      commitment_type: 'minimum',
    })),
    ...stretchTasks.map((task, i) => ({
      commitment_text: task,
      fragment_index: minimumTasks.length + i,
      commitment_type: 'stretch',
    })),
  ];
}
