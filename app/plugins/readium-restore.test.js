const { test, expect } = require('bun:test');
const { patchRestoreProbe, locatorStartVisible } = require('./readium-restore.cjs');

test('restore proof requires the start of the passage on screen', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 390, innerHeight: 700 };
  const rect = { left: 20, right: 200, top: 100, bottom: 120, width: 180, height: 20 };
  const range = (...rects) => ({ getClientRects: () => rects });
  try {
    expect(locatorStartVisible(null)).toBe(false);
    expect(locatorStartVisible(range())).toBe(false);
    expect(locatorStartVisible(range(rect))).toBe(true);
    expect(locatorStartVisible(range({ ...rect, left: 800, right: 980 }))).toBe(false);
    expect(locatorStartVisible(range({ ...rect, top: 800, bottom: 820 }))).toBe(false);
    // Seeing the end of a long selection is not arriving at its saved start.
    expect(locatorStartVisible(range({ ...rect, left: -400, right: -220 }, rect))).toBe(false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('pinned bundle exposes its existing locator resolver once and fails on changed code', () => {
  const source =
    'const readium={scrollToLocator:function(t){let e=T(t);return!!e&&function(t){return A(t.getBoundingClientRect())}(e)}};';
  const patched = patchRestoreProbe(source);
  expect(patchRestoreProbe(patched)).toBe(patched);
  const previousProbe = source.replace(
    '}(e)}};',
    '}(e)},aldusLocatorVisible:function(locator){return (function(range){return true;})(T(locator));}};',
  );
  expect(patchRestoreProbe(previousProbe)).toBe(patched);
  const result = new Function('T', `${patched}; return readium.aldusLocatorVisible;`)(() => null);
  expect(result({ text: { highlight: 'missing passage' } })).toBe(false);
  expect(() => patchRestoreProbe('changed bundle')).toThrow('locator resolver changed');
  expect(() => patchRestoreProbe(source + source)).toThrow('locator resolver changed');
});

test('only an exact, uniquely anchored visible quote confirms restoration', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { innerWidth: 390, innerHeight: 700 };
  const source =
    'const readium={scrollToLocator:function(t){let e=T(t);return!!e&&function(t){return A(t.getBoundingClientRect())}(e)}};';
  let quote = 'waited patiently';
  let before = 'Earlier, she ';
  let after = ' by the door.';
  let additionalPassage = '';
  let scopedText;
  const node = {};
  const element = {
    get textContent() {
      return scopedText ?? before + quote + after;
    },
    contains: (candidate) => candidate === node,
  };
  globalThis.document = {
    body: {
      get textContent() {
        return element.textContent + additionalPassage;
      },
      contains: element.contains,
    },
    querySelector: (selector) => (selector === '#saved' ? element : null),
    getElementById: (id) => (id === 'saved' ? element : null),
  };
  const range = {
    startContainer: node,
    endContainer: node,
    toString: () => quote,
    getClientRects: () => [{ left: 20, right: 200, top: 100, bottom: 120, width: 180, height: 20 }],
    cloneRange: () => {
      let context;
      return {
        selectNodeContents() {},
        setEnd() {
          context = before;
        },
        setStart() {
          context = after;
        },
        toString: () => context,
      };
    },
  };
  const probe = new Function(
    'T',
    `${patchRestoreProbe(source)}; return readium.aldusLocatorVisible;`,
  )(() => range);
  const locator = {
    text: { highlight: 'waited patiently', before: 'Earlier, she ', after: ' by the door.' },
  };
  try {
    expect(probe(locator)).toBe(true);
    // Readium search inserts paragraph whitespace; DOM text nodes need not.
    before = 'Earlier,she ';
    after = ' bythe door.';
    expect(probe(locator)).toBe(true);
    before = 'Earlier, she ';
    after = ' by the door.';
    quote = 'waited silently';
    expect(probe(locator)).toBe(false);
    quote = 'waited\n patiently';
    expect(probe(locator)).toBe(true);
    before = 'Elsewhere, he ';
    expect(probe(locator)).toBe(false);
    before = 'Earlier, she ';
    after = ' by the window.';
    expect(probe(locator)).toBe(false);
    after = ' by the door.';
    additionalPassage = ' Elsewhere, he waited patiently by the window.';
    expect(probe(locator)).toBe(true);
    additionalPassage = ' Earlier, she waited patiently by the door.';
    expect(probe(locator)).toBe(false);
    // A saved element distinguishes otherwise identical passages in a chapter.
    expect(probe({ ...locator, locations: { cssSelector: '#saved' } })).toBe(true);
    expect(probe({ ...locator, locations: { fragments: ['saved'] } })).toBe(true);
    expect(probe({ ...locator, locations: { cssSelector: '#missing' } })).toBe(false);
    expect(probe({ ...locator, locations: { fragments: ['missing'] } })).toBe(false);
    scopedText = element.textContent + additionalPassage;
    expect(probe({ ...locator, locations: { cssSelector: '#saved' } })).toBe(false);
    scopedText = undefined;
    range.endContainer = {};
    expect(probe({ ...locator, locations: { cssSelector: '#saved' } })).toBe(false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
