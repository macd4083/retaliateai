/**
 * @typedef {'equal'|'insert'|'delete'} DiffType
 * @typedef {Object} DiffLine
 * @property {DiffType} type
 * @property {string} value
 * @property {number|null} originalLineNum
 * @property {number|null} modifiedLineNum
 */

const MAX_LINES = 3000;

function splitLines(input) {
  if (!input) return [];
  return String(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').slice(0, MAX_LINES);
}

/**
 * @param {string} original
 * @param {string} modified
 * @returns {DiffLine[]}
 */
export function computeDiff(original, modified) {
  const a = splitLines(original);
  const b = splitLines(modified);

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  /** @type {DiffLine[]} */
  const diff = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      diff.push({
        type: 'equal',
        value: a[i],
        originalLineNum: i + 1,
        modifiedLineNum: j + 1,
      });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({
        type: 'delete',
        value: a[i],
        originalLineNum: i + 1,
        modifiedLineNum: null,
      });
      i += 1;
    } else {
      diff.push({
        type: 'insert',
        value: b[j],
        originalLineNum: null,
        modifiedLineNum: j + 1,
      });
      j += 1;
    }
  }

  while (i < m) {
    diff.push({
      type: 'delete',
      value: a[i],
      originalLineNum: i + 1,
      modifiedLineNum: null,
    });
    i += 1;
  }

  while (j < n) {
    diff.push({
      type: 'insert',
      value: b[j],
      originalLineNum: null,
      modifiedLineNum: j + 1,
    });
    j += 1;
  }

  return diff;
}

function getStartLine(diffLines, startIndex, key) {
  for (let i = startIndex; i >= 0; i -= 1) {
    const value = diffLines[i]?.[key];
    if (typeof value === 'number') return value;
  }
  return 1;
}

/**
 * @param {DiffLine[]} diffLines
 * @param {string} originalFile
 * @param {string} modifiedFile
 * @param {number} context
 * @returns {string}
 */
export function diffToUnifiedPatch(diffLines, originalFile, modifiedFile, context = 3) {
  const safeContext = Number.isFinite(context) && context >= 0 ? Math.floor(context) : 3;
  const lines = [`--- a/${originalFile}`, `+++ b/${modifiedFile}`];

  const changedIndices = [];
  for (let i = 0; i < diffLines.length; i += 1) {
    if (diffLines[i].type !== 'equal') changedIndices.push(i);
  }

  if (changedIndices.length === 0) {
    return `${lines.join('\n')}\n`;
  }

  const hunks = [];
  for (let i = 0; i < changedIndices.length; i += 1) {
    const index = changedIndices[i];
    let start = Math.max(index - safeContext, 0);
    let end = Math.min(index + safeContext, diffLines.length - 1);

    while (i + 1 < changedIndices.length && changedIndices[i + 1] <= end + safeContext + 1) {
      i += 1;
      end = Math.min(changedIndices[i] + safeContext, diffLines.length - 1);
    }

    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      hunks.push({ start, end });
    }
  }

  hunks.forEach(({ start, end }) => {
    const hunkLines = diffLines.slice(start, end + 1);
    let oldCount = 0;
    let newCount = 0;

    hunkLines.forEach((line) => {
      if (line.type !== 'insert') oldCount += 1;
      if (line.type !== 'delete') newCount += 1;
    });

    const oldStart = getStartLine(diffLines, start, 'originalLineNum');
    const newStart = getStartLine(diffLines, start, 'modifiedLineNum');

    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

    hunkLines.forEach((line) => {
      const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
      lines.push(`${prefix}${line.value}`);
    });
  });

  return `${lines.join('\n')}\n`;
}

/**
 * @param {DiffLine[]} diffLines
 */
export function getDiffStats(diffLines) {
  const stats = {
    additions: 0,
    deletions: 0,
    unchanged: 0,
    total: diffLines.length,
  };

  diffLines.forEach((line) => {
    if (line.type === 'insert') stats.additions += 1;
    if (line.type === 'delete') stats.deletions += 1;
    if (line.type === 'equal') stats.unchanged += 1;
  });

  return stats;
}
