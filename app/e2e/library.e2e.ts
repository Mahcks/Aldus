import { expect, test } from '@playwright/test';

test('Library retains a failed page across Browse navigation and retries that page', async ({
  page,
}) => {
  const offsets: number[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me')
      json = { id: 'reader', username: 'reader', display_name: 'Reader', admin: false };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path.startsWith('/catalog/')) json = { items: [], has_more: false };
    if (path === '/works') {
      const offset = Number(url.searchParams.get('offset'));
      offsets.push(offset);
      if (offset === 24 && offsets.filter((value) => value === 24).length === 1) {
        await route.fulfill({ status: 500, json: { error: 'Unavailable' } });
        return;
      }
      json = {
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `book-${offset + index}`,
          title: `Book ${offset + index}`,
          author: 'Author',
          library_id: 'library',
        })),
        has_more: offset === 0,
      };
    }
    await route.fulfill({ json });
  });
  await page.goto('/books');
  await expect(page.getByRole('button', { name: 'Book 0 by Author', exact: true })).toBeVisible();
  const main = page.getByRole('main');
  await main.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByText('Couldn’t load more books', { exact: true })).toBeVisible();
  await main.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: /Collections Your saved book lists/ }).click();
  await expect(page).toHaveURL(/\/collections$/);
  await page.goBack();
  await expect(page.getByText('Couldn’t load more books', { exact: true })).toBeAttached();
  await main.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Couldn’t load more books', { exact: true })).toHaveCount(0);
  expect(offsets).toEqual([0, 24, 24]);
});
