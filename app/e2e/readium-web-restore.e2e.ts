import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync('src/components/consumption/reader/readium-web-restore.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

test('legacy Readium anchors resolve their exact DOM start across markup and whitespace', async ({
  page,
}) => {
  const results = await page.evaluate((source) => {
    const exports = {} as {
      findReadiumRange: (doc: Document, locator: unknown) => Range | undefined;
    };
    new Function('exports', source)(exports);
    const doc = new DOMParser().parseFromString(
      '<body><p>😀 Earlier she <em>waited\n patiently</em> by the <b>door.</b></p><p>Elsewhere he waited patiently outside.</p></body>',
      'text/html',
    );
    const locator = {
      href: 'chapter.xhtml',
      type: 'application/xhtml+xml',
      locations: { progression: 0.9 },
      text: { before: '😀 Earlier she ', highlight: 'waited patiently', after: ' by the door.' },
    };
    const range = exports.findReadiumRange(doc, locator)!;
    const emoji = exports.findReadiumRange(doc, { ...locator, text: { highlight: '😀 Earlier' } })!;
    const across = exports.findReadiumRange(doc, {
      ...locator,
      text: { highlight: 'patiently by the door.' },
    })!;
    return {
      text: range.toString(),
      start: range.startOffset,
      parent: range.startContainer.parentElement?.tagName,
      emoji: emoji.toString(),
      emojiStart: emoji.startOffset,
      emojiEnd: emoji.endOffset,
      across: across.toString(),
      acrossStart: across.startOffset,
      acrossEnd: across.endOffset,
    };
  }, source);
  expect(results).toEqual({
    text: 'waited\n patiently',
    start: 0,
    parent: 'EM',
    emoji: '😀 Earlier',
    emojiStart: 0,
    emojiEnd: 10,
    across: 'patiently by the door.',
    acrossStart: 8,
    acrossEnd: 5,
  });
});

test('missing, ambiguous and mismatched Readium evidence never becomes an approximate restore', async ({
  page,
}) => {
  const results = await page.evaluate((source) => {
    const exports = {} as {
      findReadiumRange: (doc: Document, locator: unknown) => Range | undefined;
    };
    new Function('exports', source)(exports);
    const doc = new DOMParser().parseFromString(
      '<body><p>First she waited patiently here.</p><p>Then she waited patiently there.</p><p>ab c</p><p hidden>unique hidden quote</p><script>unique script quote</script></body>',
      'text/html',
    );
    const locator = {
      href: 'chapter.xhtml',
      type: 'application/xhtml+xml',
      locations: { progression: 0.5 },
    };
    return [
      undefined,
      { highlight: ' ' },
      { highlight: 'missing passage' },
      { highlight: 'waited patiently' },
      { highlight: 'waited patiently', before: 'Nobody ' },
      { highlight: 'waited patiently', after: ' nowhere.' },
      { highlight: 'Waited patiently' },
      { highlight: 'unique hidden quote' },
      { highlight: 'unique script quote' },
      { highlight: 'a bc' },
    ].map((text) => Boolean(exports.findReadiumRange(doc, { ...locator, text })));
  }, source);
  expect(results).toEqual(Array(10).fill(false));
});

test('full captured selection restores both boundaries across inline markup and paragraphs', async ({
  page,
}) => {
  const compile = (path: string) =>
    ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  const result = await page.evaluate(
    ({ captureSource, helperSource, restoreSource }) => {
      const helpers: any = {};
      new Function('exports', helperSource)(helpers);
      const capture: any = {};
      new Function('exports', 'require', captureSource)(capture, () => helpers);
      const restore: any = {};
      new Function('exports', restoreSource)(restore);
      document.body.innerHTML =
        '<p>Before. 😀 The <em>table was a large one,</em> but the three were crowded.</p><p>At one corner: “No <b>room!</b>” After.</p>';
      const first = document.querySelector('p')!.firstChild!;
      const last = document.querySelector('b')!.firstChild!;
      const range = document.createRange();
      range.setStart(first, first.textContent!.indexOf('😀'));
      range.setEnd(last, last.textContent!.length);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const saved = capture.captureSelectionRange(document, 'chapter.xhtml');
      selection.removeAllRanges();
      const restored = restore.findReadiumRange(document, helpers.selectionLocator(saved));
      return {
        text: saved.text,
        expected: range.toString().replace(/\s+/gu, ' ').trim(),
        restored: restored.toString().replace(/\s+/gu, ' ').trim(),
        sameStart:
          restored.startContainer === range.startContainer &&
          restored.startOffset === range.startOffset,
        sameEnd:
          restored.endContainer === range.endContainer && restored.endOffset === range.endOffset,
      };
    },
    {
      captureSource: compile('src/components/consumption/reader/selection-range.ts'),
      helperSource: compile('src/lib/consumption/resume-selection.ts'),
      restoreSource: source,
    },
  );
  expect(result.text).toBe(result.expected);
  expect(result.restored).toBe(result.expected);
  expect(result.sameStart).toBe(true);
  expect(result.sameEnd).toBe(true);
});
