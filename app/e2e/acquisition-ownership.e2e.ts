import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`download ownership explains cancellation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'owner', username: 'max', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'owner' }];
      if (path.endsWith('/title-requests/page')) json = { items: [] };
      if (path === '/acquisition-settings')
        json = { indexer_kind: 'prowlarr', indexer_url: '', qbittorrent_url: '' };
      if (path.endsWith('/acquisition-requests'))
        json = ['created', 'adopted', 'unknown'].map((ownership) => ({
          id: ownership,
          selected_title:
            ownership === 'created'
              ? 'Alice'
              : ownership === 'adopted'
                ? 'Treasure Island'
                : 'Frankenstein',
          query:
            ownership === 'created'
              ? 'Alice'
              : ownership === 'adopted'
                ? 'Treasure Island'
                : 'Frankenstein',
          fulfillment_state: 'downloading',
          torrent_ownership: ownership,
          can_cancel: true,
          updated_at: '2026-09-08T10:00:00Z',
        }));
      await route.fulfill({ json });
    });
    await page.goto('/acquisitions');
    await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await expect(page.getByText(/Created by Aldus. Canceling can remove/)).toBeVisible();
    await expect(page.getByText(/Canceling this request keeps the torrent/)).toHaveCount(2);
    await page.screenshot({
      path: `../artifacts/acquisition-diagnostics/ownership-${width}.png`,
      fullPage: true,
    });
  });
}
