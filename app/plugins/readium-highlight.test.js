const { test, expect } = require('bun:test');
const { patchHighlightRects } = require('./readium-highlight.cjs');

test('highlight patch is repeatable and refuses a changed toolkit hook', () => {
  const source = 'function D(t,e){let r=t.getClientRects();const n=[];return r;}';
  const patched = patchHighlightRects(source);
  expect(patchHighlightRects(patched)).toBe(patched);
  expect(() => patchHighlightRects('changed toolkit')).toThrow('decoration rectangles changed');
  expect(() => patchHighlightRects(source + source)).toThrow('decoration rectangles changed');
});
