import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`SABnzbd setup and processing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let saved: Record<string, unknown> = {
      indexer_kind: 'prowlarr',
      indexer_url: 'http://prowlarr:9696',
      qbittorrent_url: '',
      qbittorrent_username: '',
      qbittorrent_category: '',
      qbittorrent_download_root: '',
    };
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'owner', username: 'max', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'owner' }];
      if (path.endsWith('/title-requests/page')) json = { items: [] };
      if (path.endsWith('/acquisition-requests'))
        json = [
          {
            id: 'request',
            library_id: 'family',
            query: 'Alice',
            selected_title: 'Alice EPUB',
            fulfillment_state: 'downloading',
            download_state: 'downloading',
            download_client_kind: 'sabnzbd',
            client_state: 'extracting',
            updated_at: '2026-09-08T12:00:00Z',
          },
        ];
      if (path === '/acquisition-settings') {
        if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
        json = saved;
      }
      if (path === '/acquisition-settings/test')
        json = {
          prowlarr_ok: true,
          qbittorrent_configured: false,
          qbittorrent_ok: false,
          sabnzbd_configured: true,
          sabnzbd_ok: true,
          sabnzbd_file_visibility: 'not_tested',
          search: {
            reachable: true,
            indexers: [
              {
                name: 'Usenet books',
                results: 1,
                excluded: 0,
                capabilities: 'Book and audiobook categories are supported.',
              },
            ],
          },
        };
      await route.fulfill({ json });
    });
    await page.goto('/acquisitions');
    await page.getByRole('tab', { name: 'Connections', exact: true }).click();
    const editor = page.getByRole('button', { name: 'Configure SABnzbd', exact: true });
    await expect(editor).toHaveAttribute('aria-expanded', 'false');
    await editor.click();
    await expect(page.getByRole('button', { name: 'Hide SABnzbd', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.getByLabel('SABnzbd URL', { exact: true }).fill('http://sabnzbd:8080');
    await page.getByLabel('SABnzbd API key', { exact: true }).fill('test-key');
    await page.getByLabel('SABnzbd completed download root').fill('/completed');
    await page.getByRole('button', { name: 'Save connections', exact: true }).click();
    await expect(page.getByText('SABnzbd connected', { exact: true })).toBeVisible();
    await expect(page.getByText('qBittorrent unavailable', { exact: true })).toHaveCount(0);
    expect(saved.sabnzbd_url).toBe('http://sabnzbd:8080');
    await page.getByRole('button', { name: 'Show help', exact: true }).click();
    await expect(page.getByText('Use an address reachable', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Hide help', exact: true }).click();
    await page.screenshot({
      path: `../artifacts/sabnzbd/${width}-connections.png`,
      fullPage: true,
    });
    // Trending save must preserve saved connections and keep unfinished drafts.
    await page.getByLabel('SABnzbd URL', { exact: true }).fill('http://unfinished:8080');
    await expect(
      page.getByRole('button', { name: 'Test connections', exact: true }),
    ).toBeDisabled();
    await page.getByLabel('NYT API key', { exact: true }).fill('nyt-test-key');
    await page.getByRole('button', { name: 'Save trending settings', exact: true }).click();
    await expect(page.getByText('Trending settings saved.', { exact: true })).toBeVisible();
    expect(saved.sabnzbd_url).toBe('http://sabnzbd:8080');
    expect(saved.nyt_api_key).toBe('nyt-test-key');
    await expect(page.getByLabel('SABnzbd URL', { exact: true })).toHaveValue(
      'http://unfinished:8080',
    );
    await page.route('**/acquisition-settings/test', (route) =>
      route.fulfill({ status: 503, json: { error: 'Test service unavailable' } }),
    );
    await page.getByRole('button', { name: 'Save connections', exact: true }).click();
    await expect(
      page.getByText(/Connections were saved, but the check could not finish/),
    ).toBeVisible();
    expect(saved.sabnzbd_url).toBe('http://unfinished:8080');
    await page.getByText('Find releases', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/sabnzbd/${width}-overview.png` });
    await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await expect(page.getByText('Unpacking', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/sabnzbd/${width}-downloads.png` });
  });
}
