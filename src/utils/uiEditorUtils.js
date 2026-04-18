// @ts-nocheck
function safeParseHTML(html) {
  if (typeof window === 'undefined' || !window.DOMParser) {
    return null;
  }
  const parser = new DOMParser();
  return parser.parseFromString(html || '', 'text/html');
}

function serializeDoc(doc) {
  if (!doc) return '';
  return doc.documentElement?.outerHTML || doc.body?.innerHTML || '';
}

function toKebabCase(key) {
  return String(key || '')
    .replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    .replace(/^ms-/, '-ms-');
}

function styleObjectToString(styles = {}) {
  return Object.entries(styles)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => `${toKebabCase(key)}: ${String(value)};`)
    .join(' ');
}

function escapeCSSIdentifier(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value || ''));
  }
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function tagHTMLElements(html) {
  const doc = safeParseHTML(html);
  if (!doc) return html || '';

  let counter = 0;
  doc.querySelectorAll('*').forEach((el) => {
    if (!el.hasAttribute('data-eid')) {
      el.setAttribute('data-eid', `eid-${counter}`);
      counter += 1;
    }
  });

  return serializeDoc(doc);
}

export function applyOverridesToHTML(html, overrides = {}) {
  const doc = safeParseHTML(html);
  if (!doc) return html || '';

  Object.entries(overrides || {}).forEach(([eid, override]) => {
    const target = doc.querySelector(`[data-eid="${eid}"]`);
    if (!target || !override) return;

    if (override.styles && typeof override.styles === 'object') {
      Object.entries(override.styles).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined) {
          target.style[key] = '';
          return;
        }
        target.style[key] = String(value);
      });
    }

    if (typeof override.textContent === 'string') {
      target.textContent = override.textContent;
    }

    if (override.attrs && typeof override.attrs === 'object') {
      Object.entries(override.attrs).forEach(([attr, value]) => {
        if (value === '' || value === null || value === undefined) {
          target.removeAttribute(attr);
          return;
        }
        target.setAttribute(attr, String(value));
      });
    }
  });

  return serializeDoc(doc);
}

export function computeHTMLDiff(original, modified) {
  const originalLines = String(original || '').split('\n');
  const modifiedLines = String(modified || '').split('\n');
  const max = Math.max(originalLines.length, modifiedLines.length);
  const out = [];

  for (let i = 0; i < max; i += 1) {
    const left = originalLines[i];
    const right = modifiedLines[i];

    if (left === right) {
      if (left !== undefined) out.push(` ${left}`);
      continue;
    }

    if (left !== undefined) out.push(`-${left}`);
    if (right !== undefined) out.push(`+${right}`);
  }

  return out.join('\n');
}

export function exportHTMLWithStyles(html, overrides = {}) {
  const tagged = tagHTMLElements(html || '');
  const updatedHTML = applyOverridesToHTML(tagged, overrides);
  const exportDoc = safeParseHTML(updatedHTML);

  const cssRules = Object.entries(overrides || {})
    .map(([eid, override]) => {
      const styleString = styleObjectToString(override?.styles || {});
      if (!styleString) return '';
      return `.${escapeCSSIdentifier(eid)} { ${styleString} }`;
    })
    .filter(Boolean);

  if (exportDoc) {
    Object.keys(overrides || {}).forEach((eid) => {
      const target = exportDoc.querySelector(`[data-eid="${eid}"]`);
      if (!target) return;
      target.classList.add(eid);
    });
  }

  const finalHTML = exportDoc ? serializeDoc(exportDoc) : updatedHTML;
  const cssBlock = cssRules.length > 0 ? `<style>\n${cssRules.join('\n')}\n</style>` : '<style>\n/* No style overrides */\n</style>';
  const diff = computeHTMLDiff(tagged, finalHTML);

  return {
    html: finalHTML,
    cssBlock,
    diff,
  };
}

export function cssTailwindHints(styles = {}) {
  const hints = new Set();

  const fontSizeMap = {
    '12px': 'text-xs',
    '14px': 'text-sm',
    '16px': 'text-base',
    '18px': 'text-lg',
    '20px': 'text-xl',
    '24px': 'text-2xl',
    '30px': 'text-3xl',
  };

  const weightMap = {
    '100': 'font-thin',
    '200': 'font-extralight',
    '300': 'font-light',
    '400': 'font-normal',
    normal: 'font-normal',
    '500': 'font-medium',
    '600': 'font-semibold',
    '700': 'font-bold',
    bold: 'font-bold',
    '800': 'font-extrabold',
    '900': 'font-black',
  };

  const colorMap = {
    '#ffffff': 'text-white',
    '#fff': 'text-white',
    'rgb(255, 255, 255)': 'text-white',
    '#000000': 'text-black',
    '#000': 'text-black',
    'rgb(0, 0, 0)': 'text-black',
    '#ef4444': 'text-red-500',
    '#3b82f6': 'text-blue-500',
    '#10b981': 'text-emerald-500',
  };

  const bgColorMap = {
    '#ffffff': 'bg-white',
    '#fff': 'bg-white',
    '#000000': 'bg-black',
    '#000': 'bg-black',
    '#ef4444': 'bg-red-500',
    '#3b82f6': 'bg-blue-500',
    '#10b981': 'bg-emerald-500',
  };

  if (styles.fontSize && fontSizeMap[styles.fontSize]) hints.add(fontSizeMap[styles.fontSize]);
  if (styles.fontWeight && weightMap[String(styles.fontWeight)]) hints.add(weightMap[String(styles.fontWeight)]);
  if (styles.color && colorMap[String(styles.color).toLowerCase()]) hints.add(colorMap[String(styles.color).toLowerCase()]);
  if (styles.backgroundColor && bgColorMap[String(styles.backgroundColor).toLowerCase()]) {
    hints.add(bgColorMap[String(styles.backgroundColor).toLowerCase()]);
  }

  if (styles.display === 'flex') hints.add('flex');
  if (styles.display === 'grid') hints.add('grid');
  if (styles.justifyContent === 'center') hints.add('justify-center');
  if (styles.alignItems === 'center') hints.add('items-center');
  if (styles.textAlign === 'center') hints.add('text-center');
  if (styles.borderRadius === '9999px') hints.add('rounded-full');
  if (styles.borderRadius === '8px') hints.add('rounded-lg');
  if (styles.opacity === '0.5') hints.add('opacity-50');

  return Array.from(hints);
}
