const fs = require('node:fs');

// Readium 3.5 already resolves text quotes and DOM locators. Reuse that resolver
// to verify the start of the saved passage, not merely its chapter or percentage.
function locatorStartVisible(range, locator, diagnostics = false) {
  const fail = (reason) => (diagnostics ? reason : false);
  if (!range) return fail('range-not-found');
  // Readium's quote resolver accepts fuzzy matches. They are useful for moving
  // around a publication, but cannot prove that this saved passage was found.
  const normalize = (text) => text.replace(/\s+/gu, ' ').trim();
  // Search snippets insert paragraph separators that DOM Range/textContent omit.
  // Ignore whitespace in context only; the selected quote still matches exactly.
  const contextText = (text) => text.replace(/\s+/gu, '');
  const text = locator?.text;
  if (text?.highlight) {
    const quote = normalize(text.highlight);
    if (!quote || normalize(range.toString()) !== quote) return fail('quote-mismatch');
    const context = range.cloneRange();
    if (text.before) {
      context.selectNodeContents(document.body);
      context.setEnd(range.startContainer, range.startOffset);
      if (!contextText(context.toString()).endsWith(contextText(text.before)))
        return fail('before-context-mismatch');
    }
    if (text.after) {
      context.selectNodeContents(document.body);
      context.setStart(range.endContainer, range.endOffset);
      if (!contextText(context.toString()).startsWith(contextText(text.after)))
        return fail('after-context-mismatch');
    }

    // A quote resolver chooses one match even when identical passages repeat.
    // Only a saved DOM anchor or distinct text context can disambiguate them.
    const locations = locator.locations;
    let scope = document.body;
    if (locations?.cssSelector) {
      scope = document.querySelector(locations.cssSelector);
    } else if (locations?.fragments?.length) {
      scope = locations.fragments.map((id) => document.getElementById(id)).find(Boolean);
    }
    if (!scope || !scope.contains(range.startContainer) || !scope.contains(range.endContainer)) {
      return fail('anchor-scope-mismatch');
    }
    const content = contextText(scope.textContent || '');
    const compactQuote = contextText(quote);
    const before = contextText(text.before || '');
    const after = contextText(text.after || '');
    let matches = 0;
    for (
      let index = content.indexOf(compactQuote);
      index !== -1;
      index = content.indexOf(compactQuote, index + 1)
    ) {
      const prefix = content.slice(Math.max(0, index - before.length), index).trim();
      const end = index + compactQuote.length;
      const suffix = content.slice(end, end + after.length).trim();
      // Context may extend outside a saved element. Compare the available part;
      // the full resolved range context was already checked above.
      if (before && !prefix.endsWith(before) && !before.endsWith(prefix)) continue;
      if (after && !suffix.startsWith(after) && !after.startsWith(suffix)) continue;
      matches += 1;
      if (matches > 1) return fail('ambiguous-quote');
    }
    if (matches !== 1) return fail('quote-not-in-scope');
  }
  const rect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0);
  return (
    Boolean(
      rect &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth,
    ) || fail('passage-start-offscreen')
  );
}

function cfiNodeFilter(node, blockedElements) {
  if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
  const name = node.localName.toLowerCase();
  return blockedElements.includes(name) ||
    (name === 'meta' &&
      Array.from(node.attributes).some(
        (attribute) => attribute.localName.toLowerCase() === 'http-equiv',
      )) ||
    (name === 'link' && node.getAttribute('rel')?.toLowerCase() !== 'stylesheet') ||
    (document.documentElement.localName === 'svg' && name === 'style')
    ? NodeFilter.FILTER_REJECT
    : NodeFilter.FILTER_ACCEPT;
}

// Keep the web reader's CFI resolver as the single interpretation of saved CFIs.
// It runs inside the publication document; no network or alignment is required.
function cfiAnchorRect(CFI, cfi, spineIndex, filter) {
  if (typeof cfi !== 'string' || cfi.length > 16384 || !CFI.isCFI.test(cfi)) return null;
  try {
    const parts = CFI.parse(cfi);
    if (CFI.toString(parts) !== cfi) return null;
    const path = parts.parent ?? parts;
    if (path.length !== 2) return null;
    const packagePath = path.shift();
    if (spineIndex != null && packagePath.at(-1)?.index !== (spineIndex + 1) * 2) return null;
    const start = CFI.collapse(parts)[0];
    const end = CFI.collapse(parts, true)[0];
    for (const step of [...start, ...end]) {
      if (!Number.isSafeInteger(step.index) || step.index < 1) return null;
      if (step.offset != null && (!Number.isSafeInteger(step.offset) || step.offset < 0))
        return null;
      if (step.temporal != null || step.spatial != null || step.text != null) return null;
    }
    const range = CFI.toRange(document, parts, filter);
    // The resolver can recover invalid paths using ID assertions or virtual nodes.
    // Restore only when a round trip proves the exact requested DOM boundaries.
    const actual = CFI.parse(CFI.fromRange(range, filter));
    if (CFI.compare(actual, parts) !== 0) return null;
    for (const toEnd of [false, true]) {
      const requestedPath = CFI.collapse(parts, toEnd)[0];
      const actualPath = CFI.collapse(actual, toEnd)[0];
      if (requestedPath.some((step, index) => step.id && step.id !== actualPath[index]?.id))
        return null;
    }
    range.collapse(true);
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer;
      if (range.startOffset < node.length) {
        const length = String.fromCodePoint(node.data.codePointAt(range.startOffset)).length;
        range.setEnd(node, range.startOffset + length);
      }
    } else {
      const child = range.startContainer.childNodes[range.startOffset];
      if (!child) return null;
      range.selectNode(child);
    }
    return (
      Array.from(range.getClientRects()).find((rect) => rect.height > 0 && rect.width >= 0) ?? null
    );
  } catch {
    return null;
  }
}

function cfiFromRange(CFI, range, spineIndex, filter) {
  if (
    !Number.isSafeInteger(spineIndex) ||
    spineIndex < 0 ||
    !range ||
    range.startContainer.ownerDocument !== document ||
    range.endContainer.ownerDocument !== document
  )
    return null;
  try {
    const local = CFI.fromRange(range, filter);
    const resolved = CFI.toRange(document, CFI.parse(local), filter);
    if (
      resolved.startContainer !== range.startContainer ||
      resolved.startOffset !== range.startOffset ||
      resolved.endContainer !== range.endContainer ||
      resolved.endOffset !== range.endOffset
    )
      return null;
    return CFI.joinIndir(CFI.fake.fromIndex(spineIndex), local);
  } catch {
    return null;
  }
}

function cfiProbeSource() {
  const module = fs.readFileSync(require.resolve('foliate-js/epubcfi.js'), 'utf8');
  const source = module.replace(/^export /gm, '');
  const security = fs.readFileSync(
    require.resolve('../src/components/consumption/reader/epub-security.ts'),
    'utf8',
  );
  const blocked = security.match(/const BLOCKED_ELEMENTS = new Set\(\[([\s\S]*?)\]\)/)?.[1];
  if (!blocked) throw new Error('EPUB sanitizer changed; review CFI DOM filtering.');
  const blockedElements = Array.from(blocked.matchAll(/'([^']+)'/g), (match) => match[1]);
  return `/* Aldus CFI begin */
    ,aldusCFI:(function(){${source}
      const CFI={isCFI,parse,collapse,toRange,fromRange,compare,toString,joinIndir,fake};
      const filter = node => (${cfiNodeFilter.toString()})(node,${JSON.stringify(blockedElements)});
      return { check:function(cfi,scroll,spineIndex){
        const rect=(${cfiAnchorRect.toString()})(CFI,cfi,spineIndex,filter);
        if(!rect)return false;
        if(scroll)return A(rect);
        return rect.bottom>0&&rect.top<innerHeight&&rect.right>=0&&rect.left<innerWidth;
      },fromRange:function(range,spineIndex){
        return (${cfiFromRange.toString()})(CFI,range,spineIndex,filter);
      }};
    })(),aldusRestoreCFI:function(cfi,spineIndex){return this.aldusCFI.check(cfi,true,spineIndex);}
    ,aldusCFIVisible:function(cfi,spineIndex){return this.aldusCFI.check(cfi,false,spineIndex);}
    ,aldusCFIFromRange:function(range,spineIndex){return this.aldusCFI.fromRange(range,spineIndex);}
    /* Aldus CFI end */`;
}

function patchRestoreProbe(source) {
  const marker = 'aldusLocatorVisible:function(locator,diagnostics)';
  source = source.replace(/\/\* Aldus CFI begin \*\/[\s\S]*?\/\* Aldus CFI end \*\//g, '');
  // Replace the previous probe too, when CocoaPods reuses a patched toolkit.
  source = source.replace(
    /,aldusLocatorVisible:function\(locator(?:,diagnostics)?\)\{return \([\s\S]*?\)\(T\(locator\)(?:, locator(?:, diagnostics)?)?\);\}/,
    '',
  );

  // Exact shipped 3.5 bundle hook, including its existing range resolver (T).
  // Fail on a toolkit upgrade instead of guessing at renamed bundle internals.
  const hook =
    'scrollToLocator:function(t){let e=T(t);return!!e&&function(t){return A(t.getBoundingClientRect())}(e)}';
  if (source.split(hook).length !== 2) {
    throw new Error('Readium locator resolver changed; review the restore visibility probe.');
  }
  return source.replace(
    hook,
    `${hook},${marker}{return (${locatorStartVisible.toString()})(T(locator), locator, diagnostics);}${cfiProbeSource()}`,
  );
}

module.exports = { patchRestoreProbe, locatorStartVisible, cfiAnchorRect };
