function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

/**
 * @param {Element | null} el
 * @returns {string}
 */
export function buildSelector(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

  if (el.id) {
    return `#${cssEscape(el.id)}`;
  }

  const parts = [];
  let current = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    let segment = tag;

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter(
        (child) => child.tagName === current.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        segment = `${segment}:nth-of-type(${index})`;
      }
    }

    parts.unshift(segment);
    const candidate = parts.join(' > ');
    if (current.ownerDocument?.querySelectorAll(candidate).length === 1) {
      return candidate;
    }

    if (current.parentElement?.id) {
      return `#${cssEscape(current.parentElement.id)} > ${candidate}`;
    }

    current = current.parentElement;
  }

  return parts.join(' > ');
}

function formatXMLString(xml) {
  const PADDING = '  ';
  const reg = /(>)(<)(\/*)/g;
  const xmlWithBreaks = xml.replace(reg, '$1\n$2$3');
  const lines = xmlWithBreaks.split('\n');

  let indent = 0;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';

      if (trimmed.match(/^<\//)) {
        indent = Math.max(indent - 1, 0);
      }

      const formatted = `${PADDING.repeat(indent)}${trimmed}`;

      if (trimmed.match(/^<[^!?/][^>]*[^/]>/)) {
        indent += 1;
      }

      return formatted;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {Node | null} root
 * @param {{ stripScripts?: boolean }} [opts]
 * @returns {string}
 */
export function serializeDOM(root, opts = {}) {
  if (!root) return '';

  const { stripScripts = true } = opts;
  const clone = root.cloneNode(true);

  if (stripScripts && clone.nodeType === Node.ELEMENT_NODE) {
    clone.querySelectorAll('script').forEach((node) => node.remove());
  }

  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(clone);
  return formatXMLString(raw);
}

/**
 * @param {HTMLElement | null} el
 */
export function getInlineStyle(el) {
  return el?.style?.cssText || '';
}

/**
 * @param {Element | null} el
 */
export function captureRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;

  const rect = el.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
    right: rect.right,
  };
}
