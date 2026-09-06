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
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me')
      json = { id: 'reader', username: 'reader', display_name: 'Reader', admin: false };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/acquisition-capabilities') json = { enabled: false, destinations: [] };
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
