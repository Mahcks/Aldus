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
