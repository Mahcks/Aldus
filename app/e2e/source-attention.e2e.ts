import { expect, test } from '@playwright/test';
for (const width of [390, 1024, 1440]) {
  test(`source attention at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const sources = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      library_id: 'lib',
      name: `Source ${i}`,
      enabled: true,
      auto_import: false,
    }));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'admin', username: 'admin', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries')
        json = [{ id: 'lib', name: 'Library', role: 'owner', effective: true }];
      if (path === '/libraries/lib/sources') json = sources;
      if (path.endsWith('/scans')) {
        const id = path.split('/')[4];
        json = [
          {
            id: `scan${id}`,
            source_id: id,
            state: 'completed',
            supported: 30,
            new: 0,
            changed: 0,
            unchanged: 30,
            missing: id === '0' ? 4 : 0,
            problems: id === '7' ? 1 : 0,
            auto_imported: 0,
            created_at: new Date().toISOString(),
          },
        ];
      }
      if (path === '/me/notifications/unread-count') json = { unread_count: 0 };
      await route.fulfill({ json });
    });
    await page.goto('/sources');
    await expect(page.getByText('Needs your attention · 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Source 0: 4 files are missing', { exact: true })).toBeVisible();
    await expect(page.getByText(/30 books found/)).toHaveCount(0);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'View source', exact: true }).nth(1).click();
      const target = page.getByRole('button', { name: 'Inspect files (0)', exact: true });
      await expect(target).toBeInViewport();
      await expect(page.getByText(/30 files found/).first()).toBeVisible();
      await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Source 7');
    }
    await page.getByRole('button', { name: 'Inspect files (0)', exact: true }).click();
    await expect(page.getByText('No discovered files yet.', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-source-attention.png` });
  });
}
