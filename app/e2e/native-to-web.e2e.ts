import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

test('legacy native saved place restores exactly on web without alignment or startup writes', async ({
  page,
}) => {
  await signInAsTestAdmin(page);
  const work = '**/works/alice-gutenberg-11-work';
  await page.route(`${work}/progress`, (route) =>
    route.fulfill({ status: 404, body: 'not found' }),
  );
  await page.route(`${work}/alignment-jobs`, (route) => route.fulfill({ json: [] }));
  await page.route(`${work}/preference`, (route) => route.fulfill({ json: null }));
  let saved: { href: string; cfi: string } | undefined;
  let writes = 0;
  await page.route('**/representations/*/state', async (route) => {
    if (route.request().method() === 'PUT') writes++;
    await route.fulfill({
      json: {
        representation_id: new URL(route.request().url()).pathname.split('/').at(-2),
        epub_locator: saved,
        revision: 1,
        updated_at: '2026-09-25T12:00:00Z',
      },
    });
  });
  const url = '/consume/alice-gutenberg-11-work?mode=read';
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Open table of contents' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  await page.getByRole('button', { name: 'CHAPTER I. Down the Rabbit-Hole' }).click();
  await expect
    .poll(() =>
      page.locator('foliate-view').evaluate((element) => {
        const view = element as any;
        const doc = view.renderer.getContents()[0]?.doc;
        return doc
          ? Array.from(doc.querySelectorAll('p')).filter(
              (p: any) => p.textContent.trim().length > 100,
            ).length
          : 0;
      }),
    )
    .toBeGreaterThan(10);
  const target = await page.locator('foliate-view').evaluate((element) => {
    const view = element as any;
    const content = view.renderer.getContents()[0];
    const paragraphs = Array.from(content.doc.querySelectorAll('p')) as Element[];
    const paragraph = paragraphs.filter((p) => (p.textContent?.trim().length ?? 0) > 100)[10];
    if (!paragraph) throw new Error('Missing Alice chapter fixture paragraph');
    return {
      href: view.book.sections[content.index].id,
      quote: paragraph.textContent!.trim().slice(0, 100).replace(/\s+/gu, ' '),
    };
  });
  saved = {
    href: target.href,
    cfi: JSON.stringify({
      href: target.href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.99 },
      text: { highlight: target.quote },
    }),
  };
  await page.goto('/libraries');
  writes = 0;
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Open reader settings' })).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(() =>
      page.locator('foliate-view').evaluate((element, quote) => {
        const view = element as any;
        const content = view.renderer.getContents()[0];
        const paragraph = Array.from(content.doc.querySelectorAll('p')).find((p: any) =>
          p.textContent.trim().replace(/\s+/gu, ' ').startsWith(quote),
        ) as Element | undefined;
        if (!paragraph) return false;
        const range = content.doc.createRange();
        const walker = content.doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && !node.textContent.trim()) node = walker.nextNode();
        if (!node) return false;
        const start = node.textContent.search(/\S/u);
        range.setStart(node, start);
        range.setEnd(node, start + 1);
        const rect = range.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.left < content.doc.defaultView.innerWidth &&
          rect.top >= 0 &&
          rect.top < content.doc.defaultView.innerHeight
        );
      }, target.quote),
    )
    .toBe(true);
  expect(writes).toBe(0);
  await page.goto('/libraries');
  saved = {
    href: target.href,
    cfi: JSON.stringify({
      href: target.href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.99 },
      text: { highlight: 'This exact saved passage does not exist in Alice.' },
    }),
  };
  writes = 0;
  await page.goto(url);
  await expect(page.getByText(/Couldn.t restore your saved page/)).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByRole('button', { name: 'Open reader settings' })).toHaveCount(0);
  expect(writes).toBe(0);
});
