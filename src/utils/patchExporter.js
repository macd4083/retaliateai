/**
 * @param {string} filename
 * @param {string} extension
 */
function ensureExtension(filename, extension) {
  if (!filename) return `ui-recorder.${extension}`;
  return filename.endsWith(`.${extension}`) ? filename : `${filename}.${extension}`;
}

/**
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * @param {string} patchString
 * @param {string} [filename]
 */
export function downloadPatchFile(patchString, filename = 'ui-recorder.patch') {
  downloadFile(patchString, ensureExtension(filename, 'patch'), 'text/x-diff;charset=utf-8');
}

/**
 * @param {Array<Object>} changes
 * @param {Object} [meta]
 */
export function buildChangelogJson(changes, meta = {}) {
  return {
    schema: 'retaliateai.ui-recorder.v1',
    recordedAt: new Date().toISOString(),
    pageURL: meta.pageURL || window.location.href,
    adminId: meta.adminId || null,
    totalChanges: Array.isArray(changes) ? changes.length : 0,
    changes: Array.isArray(changes) ? changes : [],
  };
}

/**
 * @param {Array<Object>} changes
 * @param {Object} [meta]
 * @param {string} [filename]
 */
export function downloadJsonChangelog(changes, meta = {}, filename = 'ui-recorder-changelog.json') {
  const payload = buildChangelogJson(changes, meta);
  const jsonString = JSON.stringify(payload, null, 2);
  downloadFile(jsonString, ensureExtension(filename, 'json'), 'application/json;charset=utf-8');
}
