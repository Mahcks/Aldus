import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`catalog groups and selected narrator at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const checks: string[] = [];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'alex', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path.startsWith('/catalog/')) {
        checks.push(path);
        json = {
          items: url.searchParams.get('q')
            ? []
            : [
                {
                  name: path.endsWith('/narrators') ? 'Jane Reader' : 'Wonderland',
                  library_id: 'family',
                  library_name: 'Family',
                  work_count: 2,
                },
              ],
          has_more: false,
        };
      }
      if (path === '/works')
        json = {
          items: [
            {
              id: 'alice',
              title: 'Alice’s Adventures in Wonderland',
              author: 'Lewis Carroll',
              readable: true,
              listenable: true,
              series_position: '1',
            },
            {
              id: 'glass',
              title: 'Through the Looking-Glass',
              author: 'Lewis Carroll',
              readable: true,
              listenable: true,
              series_position: '2',
            },
          ],
          has_more: false,
        };
      await route.fulfill({ json });
    });
    await page.goto('/catalog?kind=series');
    await page.getByRole('button', { name: 'Wonderland, 2 books, Family', exact: true }).click();
    await expect(page.getByText('Book 1', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-series-detail.png` });
    await page.goto('/catalog?kind=narrators');
    await expect(
      page.getByRole('button', { name: 'Jane Reader, 2 books, Family', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-narrators.png` });
    await page.getByRole('button', { name: 'Jane Reader, 2 books, Family', exact: true }).click();
    await expect(
      page.getByText('Audiobooks narrated by Jane Reader.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Alice’s Adventures/ })).toBeVisible();
    expect(checks.at(-1)).toBe('/catalog/narrators');
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-narrator-detail.png` });
    await page.goto('/catalog?kind=narrators');
    await page.getByPlaceholder('Search your narrators').fill('Missing narrator');
    await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  });
}
