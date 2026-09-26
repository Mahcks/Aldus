import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import ts from 'typescript';

const lifecycle = ts.transpileModule(
  readFileSync('src/components/consumption/reader/reader-location.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

test('overlapping chapter requests and layout updates finish on the last requested chapter', async ({
  page,
}) => {
  test.setTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://reader.test/**', (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
      body: route.request().url().endsWith('.js')
        ? readFileSync('node_modules/foliate-js/paginator.js', 'utf8')
        : '<html><body></body></html>',
    }),
  );
  await page.goto('http://reader.test');
  const text = await page.evaluate(async (source) => {
    const exports: any = {};
    new Function('exports', source)(exports);
    // @ts-ignore This browser-only module is supplied by the route above.
    await import('/paginator.js');
    const renderer = document.createElement('foliate-paginator') as any;
    renderer.style.cssText = 'display:block;width:800px;height:600px';
    document.body.append(renderer);
    const urls = [0, 1, 2].map((index) =>
      URL.createObjectURL(
        new Blob(
          [
            `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><p>Chapter ${index}</p></body></html>`,
          ],
          { type: 'application/xhtml+xml' },
        ),
      ),
    );
    renderer.open({ sections: urls.map((url) => ({ load: async () => url })) });
    const lifetime = exports.deferredDisposal(() => {
      renderer.destroy();
      renderer.remove();
    });
    await renderer.goTo({ index: 0 });
    lifetime.settle();
    await Promise.all([
      lifetime.navigate(() => renderer.goTo({ index: 1 })),
      lifetime.navigate(() => renderer.goTo({ index: 2 })),
      lifetime.navigate(async () => renderer.setAttribute('flow', 'scrolled')),
    ]);
    const result = renderer.getContents()[0].doc.body.textContent;
    lifetime.request();
    urls.forEach((url) => URL.revokeObjectURL(url));
    return result;
  }, lifecycle);
  expect(text).toBe('Chapter 2');
  expect(errors).toEqual([]);
});

test('canonical resume restores the selected word inside a paragraph, including inline Unicode text', async ({
  page,
}) => {
  const source = ts.transpileModule(
    readFileSync('src/components/consumption/reader/canonical-range.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  await page.setContent(
    '<p id="passage">  Earlier 😀 text. <em>Saved</em>\n\t <strong>exact</strong> word here.  </p>',
  );
  const result = await page.evaluate((source) => {
    const exports: any = {};
    new Function('exports', source)(exports);
    const paragraph = document.getElementById('passage')!;
    const segment = document.createRange();
    segment.selectNodeContents(paragraph);
    const before = segment.cloneRange();
    before.setEnd(paragraph.querySelector('strong')!.firstChild!, 0);
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const offset = Math.round(
      (Array.from(normalize(before.toString())).length * 1_000_000) /
        Array.from(normalize(segment.toString())).length,
    );
    const restored: Range = exports.canonicalResumeRange(segment, offset);
    const bounded = document.createRange();
    bounded.setStart(paragraph.querySelector('em')!.firstChild!, 0);
    bounded.setEnd(paragraph.querySelector('strong')!.firstChild!, 5);
    return {
      text: restored.toString(),
      node: restored.startContainer.parentElement?.tagName,
      offset: restored.startOffset,
      first: exports.canonicalResumeRange(segment, 0).toString(),
      end: exports.canonicalResumeRange(segment, 1_000_000).collapsed,
      bounded: exports.canonicalResumeRange(bounded, 500_000).toString(),
    };
  }, source);
  expect(result).toEqual({
    text: 'exact',
    node: 'STRONG',
    offset: 0,
    first: 'Earlier',
    end: true,
    bounded: 'exact',
  });
});

test('paginator ignores layout callbacks before its chapter document is ready', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://reader.test/**', (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
      body: route.request().url().endsWith('.js')
        ? readFileSync('node_modules/foliate-js/paginator.js', 'utf8') + '\nexport { View };'
        : '<html><body></body></html>',
    }),
  );
  await page.goto('http://reader.test');
  const result = await page.evaluate(async () => {
    // @ts-ignore Test exposes Foliate's actual iframe view, without replacing its methods.
    const { View } = await import('/paginator.js');
    const view = new View({ container: {}, onExpand: () => {} });
    document.body.append(view.element);
    view.document.documentElement.remove();
    const layout = {
      flow: 'paginated',
      width: 800,
      height: 600,
      margin: 20,
      gap: 20,
      columnWidth: 760,
    };
    view.render(layout);
    view.expand();
    view.destroy();
    view.render(layout);
    view.expand();
    view.element.remove();
    return true;
  });
  expect(result).toBe(true);
  expect(errors).toEqual([]);
});

test('dragging a passage saves its start instead of the release point in either direction', async ({
  page,
}) => {
  await page.setContent(
    '<p>The table was a large one, but the three were all crowded together at one corner of it: “No room! No room!”</p>',
  );
  const positions = await page.evaluate((source) => {
    const exports: any = {};
    new Function('exports', source)(exports);
    const text = document.querySelector('p')!.firstChild!;
    const end = text.textContent!.indexOf(' room');
    const caret = document.createRange();
    caret.setStart(text, end);
    caret.collapse(true);
    const rect = caret.getBoundingClientRect();
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(text, 0, text, end);
    const forward = exports.readingIntentPoint(
      document,
      rect.x,
      rect.y + rect.height / 2,
    ).startOffset;
    selection.setBaseAndExtent(text, end, text, 0);
    const backward = exports.readingIntentPoint(
      document,
      rect.x,
      rect.y + rect.height / 2,
    ).startOffset;
    selection.removeAllRanges();
    const click = exports.readingIntentPoint(
      document,
      rect.x,
      rect.y + rect.height / 2,
    ).startOffset;
    return { forward, backward, click, end };
  }, lifecycle);
  expect(positions.forward).toBe(0);
  expect(positions.backward).toBe(0);
  expect(positions.click).toBe(positions.end);
});
