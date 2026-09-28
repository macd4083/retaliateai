export function splitCommitmentIntoTasks(text) {
  if (!text || !String(text).trim()) return [];

  const parts = String(text)
    .split(/\.\s+(?=[A-Z])|;\s*|,\s*(?:and|or)\s+|\s+(?:and|or)\s+/i)
    .map((segment) => segment.replace(/\.\s*$/, '').trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [String(text).trim()];
}
