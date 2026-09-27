import { expect, test } from '@playwright/test';
const { highlightTextRects } = require('../plugins/readium-highlight.cjs');

for (const width of [390, 1024, 1440]) {
  test(`native restored highlight follows text lines across paragraphs at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`
      <style>body {margin:24px} main {max-width:540px; font:24px/2 Georgia}
      p {text-indent:40px; margin:24px 0} mark {position:absolute; background:#ecd1b2; opacity:.6; pointer-events:none}</style>
      <main><p id="first">Earlier words. The selected passage starts here and continues over several lines.</p>
      <p>A fully selected paragraph with <em>inline emphasis</em> and enough words to wrap across multiple lines in the reader.</p>
      <p>Another fully selected paragraph should keep the blank space between its lines clear.</p>
      <p id="last">The selection stops here. These remaining words must not be highlighted.</p></main>`);
    const result = await page.evaluate((source) => {
      const rectsFor = new Function(`return (${source})`)();
      const first = document.getElementById('first')!.firstChild!;
      const last = document.getElementById('last')!.firstChild!;
      const range = document.createRange();
      range.setStart(first, 15);
      range.setEnd(last, 25);
      const before = range.toString();
      const original = Array.from(range.getClientRects());
      const rects: DOMRect[] = rectsFor(range);
      for (const rect of rects) {
        const mark = document.createElement('mark');
        Object.assign(mark.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        document.body.append(mark);
      }
      const single = document.createRange();
      single.setStart(first, 15);
      single.setEnd(first, 27);
      const expected = Array.from(single.getClientRects()).map((r) => [
        r.x,
        r.y,
        r.width,
        r.height,
      ]);
      const actual = rectsFor(single).map((r: DOMRect) => [r.x, r.y, r.width, r.height]);
      single.collapse(true);
      return {
        before,
        after: range.toString(),
        originalMax: Math.max(...original.map((r) => r.height)),
        max: Math.max(...rects.map((r) => r.height)),
        count: rects.length,
        expected,
        actual,
        collapsed: rectsFor(single).length,
      };
    }, highlightTextRects.toString());
    expect(result.before).toBe(result.after);
    expect(result.count).toBeGreaterThan(4);
    expect(result.originalMax).toBeGreaterThan(48);
    expect(result.max).toBeLessThan(48);
    expect(result.actual).toEqual(result.expected);
    expect(result.collapsed).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`native-highlight-${width}.png`) });
  });
}
