import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`release picker respects approval at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let bypass = false;
    let submissions = 0;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'reader', display_name: 'Reader' };
      if (path === '/setup/status') json = { available: false, demo_available: false };
      if (path === '/libraries')
        json = [
          {
            id: 'family',
            name: 'Family',
            role: 'reader',
            can_request_acquisitions: true,
            can_advanced_acquisition_request: true,
            can_bypass_acquisition_approval: bypass,
          },
        ];
      if (path === '/acquisition-capabilities')
        json = {
          enabled: true,
          destinations: [{ library_id: 'family', source_id: 'source' }],
        };
      if (path === '/discover/trending')
        json = [
          {
            source: 'open_library',
            title: 'Trending',
            items: [{ title: 'Alice', author: 'Carroll' }],
          },
        ];
      if (path === '/libraries/family/acquisition-discoveries')
        json = {
          id: 'discovery',
          results: [
            {
              id: 'release',
              title: 'Alice EPUB',
              canonical_title: 'Alice',
              author: 'Carroll',
              group_key: 'alice',
              kind: 'ebook',
              format: 'EPUB',
              match: 'exact',
              relevance: 100,
              size: 123,
            },
          ],
        };
      if (path.endsWith('/select')) {
        submissions++;
        json = { id: 'request' };
      }
      await route.fulfill({ json });
    });
    async function openRelease() {
      await page.goto('/search');
      await page.getByRole('button', { name: 'Alice by Carroll', exact: true }).click();
      await page.getByRole('button', { name: 'Choose a specific release', exact: true }).click();
    }
    await openRelease();
    const add = page.getByRole('button', { name: 'Add EPUB', exact: true });
    await expect(add).toBeDisabled();
    await expect(page.getByText('Your requests need approval.', { exact: false })).toBeVisible();
    expect(submissions).toBe(0);
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/057/${width}-approval.png`,
    });
    bypass = true;
    await openRelease();
    await expect(add).toBeEnabled();
    await add.click();
    await expect.poll(() => submissions).toBe(1);
  });
}
