import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`connection diagnostics and recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let mode = 'partial';
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'owner', username: 'max', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'owner' }];
      if (path.endsWith('/title-requests/page')) json = { items: [] };
      if (path === '/acquisition-settings')
        json = {
          indexer_kind: 'prowlarr',
          indexer_url: 'http://prowlarr:9696',
          qbittorrent_url: 'http://qbittorrent:8080',
          qbittorrent_username: 'aldus',
          qbittorrent_category: 'aldus',
          qbittorrent_download_root: '/downloads',
        };
      if (path === '/acquisition-settings/test')
        json = {
          prowlarr_ok: mode !== 'offline',
          qbittorrent_ok: true,
          indexer_count: 2,
          file_visibility: 'not_tested',
          search: {
            reachable: mode !== 'offline',
            indexers:
              mode === 'empty' || mode === 'offline'
                ? []
                : [
                    {
                      name: 'Family books',
                      capabilities: 'Book and audiobook categories are supported.',
                      results: 4,
                      excluded: 2,
                      error:
                        mode === 'failed' ? 'Search failed. Check this indexer in Prowlarr.' : '',
                    },
                    {
                      name: 'Audiobooks',
                      results: mode === 'ok' ? 3 : 0,
                      excluded: 0,
                      error: mode === 'ok' ? '' : 'Search failed. Check this indexer in Prowlarr.',
                    },
                  ],
          },
        };
      await route.fulfill({ json });
    });
    await page.goto('/acquisitions');
    await page.getByRole('tab', { name: 'Connections', exact: true }).click();
    const check = page.getByRole('button', { name: 'Test connections', exact: true });
    await check.click();
    await expect(page.getByText(/Partial search: 1 of 2/)).toBeVisible();
    await expect(page.getByText(/File access not tested/)).toBeVisible();
    const disclosure = page.getByRole('button', { name: 'Show search details' });
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Audiobooks', { exact: true })).toBeVisible();
    await expect(page.getByText('Book and audiobook categories are supported.')).toBeVisible();
    await page.screenshot({
      path: `../artifacts/acquisition-diagnostics/${width}.png`,
      fullPage: true,
    });
    for (const next of ['empty', 'failed', 'offline', 'ok']) {
      mode = next;
      await check.click();
      const message =
        next === 'empty'
          ? /No enabled torrent indexers/
          : next === 'failed'
            ? /All indexers failed/
            : next === 'offline'
              ? /Search provider unavailable/
              : /2 search sources responded/;
      await expect(page.getByText(message)).toBeVisible();
    }
  });
}
