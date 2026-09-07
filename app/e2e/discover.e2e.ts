import { expect, test } from '@playwright/test';

test('Discover keeps equivalent searches and ignores descriptions from closed books', async ({
  page,
}) => {
  const first = {
    title: 'First book',
    author: 'Author',
    external_source: 'open_library',
    external_id: 'OL1W',
  };
  const second = { ...first, title: 'Second book', external_id: 'OL2W' };
  let finishFirst: (() => void) | undefined;
  const firstReady = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  let firstRequested = false;
  let searches = 0;
  let trendingCalls = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me')
      json = { id: 'reader', username: 'reader', display_name: 'Reader', admin: false };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/acquisition-capabilities') json = { enabled: false, destinations: [] };
    if (path === '/discover/trending' && trendingCalls++ === 0) {
      await route.fulfill({
        status: 503,
        body: 'Trending providers are temporarily unavailable. Try again shortly.',
      });
      return;
    }
    if (path === '/discover/trending')
      json = [{ source: 'open_library', title: 'Trending', items: [first, second] }];
    if (path === '/search/titles') {
      searches++;
      json = [first];
    }
    if (path === '/discover/detail') {
      if (url.searchParams.get('id') === 'OL1W') {
        firstRequested = true;
        await firstReady;
        json = { description: 'First description' };
      } else json = { description: 'Second description' };
    }
    await route.fulfill({ json });
  });
  await page.goto('/search');
  await page.getByRole('button', { name: 'Retry trending', exact: true }).click();
  await page.getByRole('button', { name: 'First book by Author', exact: true }).click();
  await expect.poll(() => firstRequested).toBe(true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Second book by Author', exact: true }).click();
  await expect(page.getByText('Second description', { exact: true })).toBeVisible();
  const completed = page.waitForResponse(
    (response) => response.url().includes('/discover/detail?') && response.url().includes('OL1W'),
  );
  finishFirst!();
  await completed;
  await expect(page.getByText('Second description', { exact: true })).toBeVisible();
  await expect(page.getByText('First description', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const search = page.getByPlaceholder('Search by title, author, or ISBN');
  await search.fill('First');
  await expect(
    page.getByRole('button', { name: 'First book by Author', exact: true }),
  ).toBeVisible();
  await search.fill('First ');
  await expect(
    page.getByRole('button', { name: 'First book by Author', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Finding books…', { exact: true })).toHaveCount(0);
  expect(searches).toBe(1);
});

for (const width of [390, 1024, 1440]) {
  test(`Discover keeps request actions visible with a long description at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let selections = 0;
    const book = {
      title: 'Alice’s Adventures in Wonderland',
      author: 'Lewis Carroll',
      external_source: 'open_library',
      external_id: 'OL1W',
    };
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'admin', username: 'alex', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries')
        json = [{ id: 'family', name: 'Family', role: 'owner', effective: true }];
      if (path === '/acquisition-capabilities')
        json = { enabled: true, destinations: [{ library_id: 'family', library_name: 'Family' }] };
      if (path === '/request-libraries')
        json = [
          { library_id: 'family', library_name: 'Family', ebook_reason: '', audiobook_reason: '' },
        ];
      if (path === '/discover/trending')
        json = [{ source: 'open_library', title: 'Explore something new', items: [book] }];
      if (path === '/discover/detail')
        json = {
          description:
            'Follow Alice through a curious world of impossible creatures and unexpected adventures. '.repeat(
              40,
            ),
        };
      if (path === '/libraries/family/acquisition-discoveries')
        json = {
          id: 'discovery',
          results: ['EPUB', 'PDF'].map((format, index) => ({
            id: `release-${index}`,
            group_key: 'alice',
            canonical_title: book.title,
            title: book.title,
            author: book.author,
            kind: 'ebook',
            format,
            source: 'Family book catalog with a long provider name',
            size: 204800,
            match: 'exact',
            relevance: 1,
          })),
        };
      if (path.endsWith('/discovery/select')) {
        selections++;
        if (selections === 1) {
          await route.fulfill({
            status: 503,
            body: 'Download service unavailable. Retry.',
          });
          return;
        }
        json = { id: 'request', state: 'queued' };
      }
      await route.fulfill({ json });
    });
    await page.goto('/search');
    await page
      .getByRole('button', { name: `${book.title} by ${book.author}`, exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Book details' });
    await expect(dialog.getByRole('button', { name: 'Request ebook', exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Request audiobook', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    const bounds = await dialog
      .getByRole('button', { name: 'Request audiobook', exact: true })
      .boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-discover-detail.png` });
    await dialog.getByRole('button', { name: 'Choose a specific release' }).click();
    const releases = page.getByRole('dialog', { name: 'Choose a release', exact: true });
    await releases.getByRole('button', { name: 'Choose edition (2)' }).click();
    await releases.getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(releases.getByText('Download service unavailable. Retry.')).toBeVisible();
    await expect
      .poll(() =>
        releases.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-discover-releases.png` });
    await releases.getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(releases.getByText('Added', { exact: true })).toBeVisible();
    expect(selections).toBe(2);
  });
}
