import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`request queue includes history and filters approvals at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let approved = false;
    const requests = [
      {
        id: 'watching',
        title: 'Catching Fire',
        author: 'Suzanne Collins',
        state: 'awaiting_release',
      },
      {
        id: 'approval',
        title: 'The Hobbit',
        author: 'J. R. R. Tolkien',
        state: 'pending_approval',
      },
      {
        id: 'ready',
        title: 'Alice’s Adventures in Wonderland',
        author: 'Lewis Carroll',
        state: 'available',
      },
      { id: 'past', title: 'Treasure Island', author: 'Robert Louis Stevenson', state: 'canceled' },
    ];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'max', display_name: 'Max', admin: true };
      if (path === '/setup/status') json = { available: false, demo_available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family library', role: 'owner' }];
      if (path === '/users') json = [{ id: 'owner', username: 'max', display_name: 'Max' }];
      if (path === '/acquisition-settings')
        json = {
          indexer_kind: 'prowlarr',
          indexer_url: '',
          qbittorrent_url: '',
          qbittorrent_username: '',
          qbittorrent_category: 'aldus',
          qbittorrent_download_root: '',
        };
      if (path.endsWith('/approve')) approved = true;
      if (path.endsWith('/title-requests/page')) {
        const filter = url.searchParams.get('filter');
        const values = requests.map((item) => ({
          ...item,
          library_id: 'family',
          requested_by: 'owner',
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T10:00:00Z',
          formats: [
            {
              format: 'audiobook',
              state: item.id === 'approval' && approved ? 'wanted' : item.state,
              updated_at: '2026-09-08T10:00:00Z',
            },
          ],
        }));
        const cursor = url.searchParams.get('cursor');
        json = {
          items:
            filter === 'all'
              ? values.slice(cursor ? 3 : 0, cursor ? undefined : 3)
              : values.filter((item) => item.formats[0].state === filter),
          next_cursor: filter === 'all' && !cursor ? 'older' : '',
        };
      }
      await route.fulfill({ json });
    });
    await page.goto('/acquisitions');
    for (const request of requests.slice(0, 3))
      await expect(page.getByText(request.title, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show more requests' }).click();
    await expect(page.getByText('Treasure Island', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more requests' })).toHaveCount(0);
    await expect(page.getByText('Watching', { exact: true })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(page.getByText('Auto-approved', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Requests', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/acquisition-queue/${width}.png`, fullPage: true });
    const filter = page.getByRole('combobox', { name: 'Request status' });
    const heading = page.getByText('Book requests', { exact: true });
    const before = await heading.boundingBox();
    await filter.click();
    await page.keyboard.press('Escape');
    expect((await heading.boundingBox())?.y).toBe(before?.y);
    await filter.selectOption('pending_approval');
    await expect(page.getByText('Catching Fire', { exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Approve audiobook request for The Hobbit', exact: true })
      .click();
    await expect(page.getByText('No approvals waiting', { exact: true })).toBeVisible();
  });
}
