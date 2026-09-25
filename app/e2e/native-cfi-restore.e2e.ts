import { test, expect } from '@playwright/test';

import { patchRestoreProbe } from '../plugins/readium-restore.cjs';
const source = `window.readium={scrollToLocator:function(t){let e=T(t);return!!e&&function(t){return A(t.getBoundingClientRect())}(e)}};`;
const bundle = patchRestoreProbe(source);

test('native CFI restores exact range starts and rejects wrong resources or malformed anchors', async ({
  page,
}) => {
  await page.setContent(
    `<html><head></head><body style="margin:0"><p style="height:1400px">Earlier content</p><script type="text/plain">blocked</script><p id="target">The same words appear here. The same words appear here.</p><p style="height:1400px">Later content</p></body></html>`,
  );
  await page.addScriptTag({
    content: `function A(rect){window.scrollTo(0,rect.top+scrollY);return true;} function T(){return null;} ${bundle}`,
  });
  const result = await page.evaluate(() => {
    const reader = (window as any).readium;
    // The web sanitizer removed the script: target is the second body element.
    const cfi = 'epubcfi(/6/2!/4/4,/1:27,/1:53)';
    const before = reader.aldusCFIVisible(cfi, 0);
    const restored = reader.aldusRestoreCFI(cfi, 0);
    return {
      before,
      restored,
      visible: reader.aldusCFIVisible(cfi, 0),
      wrongResource: reader.aldusRestoreCFI(cfi, 1),
      invalid: [
        'epubcfi(/6/2!/4/4/1:9999)',
        'epubcfi(/6/2!/4/4/1:27garbage)',
        'epubcfi(/6/2!/4/99/1:0)',
        'epubcfi(/6/2!/4/4[wrong-id]/1:27)',
      ].map((value) => reader.aldusRestoreCFI(value, 0)),
      top: document.querySelector('#target')!.getBoundingClientRect().top,
    };
  });
  expect(result).toMatchObject({
    before: false,
    restored: true,
    visible: true,
    wrongResource: false,
    invalid: [false, false, false, false],
  });
  expect(Math.abs(result.top)).toBeLessThan(30);
});

test('native CFI restores image-only title pages without text or alignment', async ({ page }) => {
  await page.setContent(
    '<html><head></head><body><div><img width="120" height="180" alt="Cover" src="data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\"/%3E"></div></body></html>',
  );
  await page.addScriptTag({
    content: `function A(rect){window.scrollTo(0,rect.top+scrollY);return true;} function T(){return null;} ${bundle}`,
  });
  expect(
    await page.evaluate(() => {
      const reader = (window as any).readium;
      const cfi = 'epubcfi(/6/2!/4/2,,/2)';
      return [reader.aldusRestoreCFI(cfi, 0), reader.aldusCFIVisible(cfi, 0)];
    }),
  ).toEqual([true, true]);
});

test('native visible range produces stable portable CFIs with distinct exact offsets', async ({
  page,
}) => {
  await page.setContent(
    '<html><head></head><body><script type="text/plain">removed on web</script><p id="text">Repeated words. Repeated words.</p></body></html>',
  );
  await page.addScriptTag({
    content: `function A(rect){window.scrollTo(0,rect.top+scrollY);return true;} function T(){return null;} ${bundle}`,
  });
  const result = await page.evaluate(() => {
    const reader = (window as any).readium;
    const node = document.querySelector('#text')!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const first = reader.aldusCFIFromRange(range, 0);
    const repeated = reader.aldusCFIFromRange(range, 0);
    range.setStart(node, 16);
    range.setEnd(node, 17);
    const next = reader.aldusCFIFromRange(range, 0);
    return {
      first,
      repeated,
      next,
      restored: reader.aldusRestoreCFI(next, 0),
      visible: reader.aldusCFIVisible(next, 0),
      invalid: reader.aldusCFIFromRange(range, -1),
    };
  });
  expect(result.first).toBe(result.repeated);
  expect(result.first).not.toBe(result.next);
  expect(result.next).toContain('/4/2[text]');
  expect(result).toMatchObject({ restored: true, visible: true, invalid: null });
});
