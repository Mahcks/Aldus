const DOCUMENT_TYPES = new Set(['application/xhtml+xml', 'image/svg+xml', 'text/html']);
const BLOCKED_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'applet',
  'base',
  'discard',
  'embed',
  'frame',
  'frameset',
  'iframe',
  'object',
  'portal',
  'script',
  'set',
]);
const BLOCKED_ATTRIBUTES = new Set([
  'action',
  'autoplay',
  'formaction',
  'ping',
  'srcdoc',
  'srcset',
  'target',
]);
const URL_ATTRIBUTES = new Set(['background', 'href', 'poster', 'src']);
const SVG_URL_ATTRIBUTES = new Set([
  'clip-path',
  'cursor',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
]);
type TransformDetail = {
  data: string | Blob | Promise<string | Blob>;
  type: string;
};

export function installEPUBContentSecurity(book: { transformTarget?: EventTarget }) {
  if (!book.transformTarget) throw new Error('EPUB content transform is unavailable.');
  book.transformTarget.addEventListener('data', ((event: CustomEvent<TransformDetail>) => {
    const type = event.detail.type.split(';', 1)[0].trim().toLowerCase();
    if (!DOCUMENT_TYPES.has(type) && type !== 'text/css') return;
    event.detail.data = Promise.resolve(event.detail.data).then(async (data) => {
      const source = typeof data === 'string' ? data : await data.text();
      return type === 'text/css' ? sanitizeStylesheet(source) : sanitizeDocument(source, type);
    });
  }) as EventListener);
}

function sanitizeDocument(source: string, type: string) {
  const doc = new DOMParser().parseFromString(source, type as DOMParserSupportedType);
  if (doc.querySelector('parsererror')) throw new Error('EPUB document could not be sanitized.');
  const svg = type === 'image/svg+xml';

  for (const child of Array.from(doc.childNodes)) {
    if (
      child.nodeType === Node.PROCESSING_INSTRUCTION_NODE ||
      child.nodeType === Node.DOCUMENT_TYPE_NODE
    )
      (child as ChildNode).remove();
  }
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const name = element.localName.toLowerCase();
    const svgElement = element.namespaceURI === 'http://www.w3.org/2000/svg';
    if (
      BLOCKED_ELEMENTS.has(name) ||
      (name === 'meta' &&
        Array.from(element.attributes).some(
          (attribute) => attribute.localName.toLowerCase() === 'http-equiv',
        )) ||
      (name === 'link' && element.getAttribute('rel')?.toLowerCase() !== 'stylesheet') ||
      (svg && name === 'style')
    ) {
      element.remove();
      continue;
    }
    if (name === 'style' && element.textContent) {
      element.textContent = sanitizeStylesheet(element.textContent);
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.localName.toLowerCase();
      if (attributeName === 'style' && !svg) {
        const style = sanitizeInlineStyle(attribute.value);
        if (style) attribute.value = style;
        else element.removeAttributeNode(attribute);
        continue;
      }
      if (
        attributeName.startsWith('on') ||
        BLOCKED_ATTRIBUTES.has(attributeName) ||
        (URL_ATTRIBUTES.has(attributeName) &&
          !safeReference(attribute.value, name, attributeName)) ||
        (svgElement &&
          (attributeName === 'style' ||
            (SVG_URL_ATTRIBUTES.has(attributeName) &&
              !safeSVGPresentation(attributeName, attribute.value))))
      ) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

function safeReference(value: string, elementName: string, attributeName: string) {
  const reference = value.trim();
  if (!reference || safeResourceReference(reference)) return true;
  if (/^data:/i.test(reference)) {
    return (
      ['image', 'img', 'source'].includes(elementName) &&
      ['href', 'src'].includes(attributeName) &&
      /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(reference)
    );
  }
  return false;
}

function safeSVGPresentation(property: string, value: string) {
  return Boolean(sanitizeInlineStyle(`${property}: ${value}`));
}

function sanitizeStylesheet(source: string) {
  if (typeof CSSStyleSheet === 'undefined' || !CSSStyleSheet.prototype.replaceSync) return '';
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(source);
  sanitizeRules(sheet);
  return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
}

function sanitizeInlineStyle(source: string) {
  if (typeof CSSStyleSheet === 'undefined' || !CSSStyleSheet.prototype.replaceSync) return '';
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`x { ${source} }`);
  const rule = sheet.cssRules[0];
  if (!(rule instanceof CSSStyleRule)) return '';
  sanitizeDeclarations(rule.style);
  return rule.style.cssText;
}

function sanitizeRules(container: CSSStyleSheet | CSSGroupingRule) {
  for (let index = container.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = container.cssRules[index];
    if ('cssRules' in rule) sanitizeRules(rule as CSSGroupingRule);
    if ('style' in rule && rule.style instanceof CSSStyleDeclaration) {
      sanitizeDeclarations(rule.style);
    } else if (!('cssRules' in rule) && /url\s*\(/i.test(rule.cssText)) {
      container.deleteRule(index);
    }
  }
}

function sanitizeDeclarations(style: CSSStyleDeclaration) {
  for (const property of Array.from({ length: style.length }, (_, index) => style.item(index))) {
    const value = style.getPropertyValue(property);
    const references = Array.from(value.matchAll(/url\(\s*"([^"]*)"\s*\)/gi));
    if (
      (/url\s*\(/i.test(value) && references.length === 0) ||
      references.some(([, reference]) => !safeCSSReference(reference))
    ) {
      style.removeProperty(property);
    }
  }
}

function safeCSSReference(reference: string) {
  return (
    safeResourceReference(reference) ||
    /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(reference)
  );
}

function safeResourceReference(reference: string) {
  if (reference.startsWith('#') || /^blob:/i.test(reference)) return true;
  if (/^[\\/]/.test(reference)) return false;
  try {
    return new URL(reference, 'https://epub.invalid/content/').origin === 'https://epub.invalid';
  } catch {
    return false;
  }
}
