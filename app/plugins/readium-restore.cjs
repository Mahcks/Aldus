// Readium 3.5 already resolves text quotes and DOM locators. Reuse that resolver
// to verify the start of the saved passage, not merely its chapter or percentage.
function locatorStartVisible(range, locator) {
  if (!range) return false;
  // Readium's quote resolver accepts fuzzy matches. They are useful for moving
  // around a publication, but cannot prove that this saved passage was found.
  const normalize = (text) => text.replace(/\s+/gu, ' ').trim();
  const text = locator?.text;
  if (text?.highlight) {
    const quote = normalize(text.highlight);
    if (!quote || normalize(range.toString()) !== quote) return false;
    const context = range.cloneRange();
    if (text.before) {
      context.selectNodeContents(document.body);
      context.setEnd(range.startContainer, range.startOffset);
      if (!normalize(context.toString()).endsWith(normalize(text.before))) return false;
    }
    if (text.after) {
      context.selectNodeContents(document.body);
      context.setStart(range.endContainer, range.endOffset);
      if (!normalize(context.toString()).startsWith(normalize(text.after))) return false;
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
      return false;
    }
    const content = normalize(scope.textContent || '');
    const before = normalize(text.before || '');
    const after = normalize(text.after || '');
    let matches = 0;
    for (
      let index = content.indexOf(quote);
      index !== -1;
      index = content.indexOf(quote, index + 1)
    ) {
      const prefix = content.slice(Math.max(0, index - before.length - 1), index).trim();
      const end = index + quote.length;
      const suffix = content.slice(end, end + after.length + 1).trim();
      // Context may extend outside a saved element. Compare the available part;
      // the full resolved range context was already checked above.
      if (before && !prefix.endsWith(before) && !before.endsWith(prefix)) continue;
      if (after && !suffix.startsWith(after) && !after.startsWith(suffix)) continue;
      matches += 1;
      if (matches > 1) return false;
    }
    if (matches !== 1) return false;
  }
  const rect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0);
  return Boolean(
    rect &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth,
  );
}

function patchRestoreProbe(source) {
  const marker = 'aldusLocatorVisible:function(locator)';
  // Replace the previous probe too, when CocoaPods reuses a patched toolkit.
  source = source.replace(
    /,aldusLocatorVisible:function\(locator\)\{return \([\s\S]*?\)\(T\(locator\)(?:, locator)?\);\}/,
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
    `${hook},${marker}{return (${locatorStartVisible.toString()})(T(locator), locator);}`,
  );
}

module.exports = { patchRestoreProbe, locatorStartVisible };
