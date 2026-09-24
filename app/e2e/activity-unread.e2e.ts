import { expect, test } from '@playwright/test';
for (const mode of ['stale-count', 'partial-retry']) {
  test(`unread count survives ${mode}`, async ({ page }) => {
    const now = new Date().toISOString();
    const items: Record<string, unknown>[] = [
      {
        id: 'title-request:r:ebook:downloading',
        kind: 'acquisition.downloading',
        title: 'Downloading',
        body: 'Alice · Ebook',
        created_at: now,
      },
      ...(mode === 'partial-retry'
        ? [
            {
              id: 'title-request:r:ebook:approved',
              kind: 'acquisition.approved',
              title: 'Approved',
              body: 'Alice · Ebook',
              created_at: now,
            },
          ]
        : []),
      {
        id: 'title-request:admin:ebook:approval',
        kind: 'acquisition.approval_needed',
        title: 'Approval needed',
        body: 'Other book · Ebook',
        created_at: now,
        action_url: '/acquisitions',
      },
    ];
    let releaseCount: (() => void) | undefined;
    let failOnce = true;
    const unread = () => items.filter((x) => !x.read_at).length;
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'lib', name: 'Library', role: 'reader' }];
      if (path === '/libraries/lib/title-requests/page')
        json = {
          items: [
            {
              id: 'r',
              title: 'Alice',
              library_id: 'lib',
              requested_by: 'reader',
              formats: [{ format: 'ebook', state: 'downloading', updated_at: now }],
            },
          ],
        };
      if (path === '/me/notifications') json = { items, unread_count: unread() };
      if (path === '/me/notifications/unread-count') {
        json = { unread_count: unread() };
        if (mode === 'stale-count')
          await new Promise<void>((resolve) => {
            releaseCount = resolve;
          });
      }
      if (req.method() === 'POST' && path.endsWith('/read')) {
        const id = decodeURIComponent(path.split('/')[3]);
        if (mode === 'partial-retry' && id.endsWith(':approved') && failOnce) {
          failOnce = false;
          await route.fulfill({ status: 500, json: { error: 'temporary failure' } });
          return;
        }
        const item = items.find((x) => x.id === id);
        if (item) item.read_at = now;
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto('/activity');
    await page.getByRole('button', { name: 'Mark "Alice ebook" read', exact: true }).click();
    if (mode === 'stale-count') {
      await expect(
        page.getByRole('button', { name: 'Mark "Alice ebook" read', exact: true }),
      ).toBeHidden();
      await expect.poll(() => Boolean(releaseCount)).toBe(true);
      const response = page.waitForResponse((r) => r.url().includes('/unread-count'));
      releaseCount!();
      await response;
    } else {
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Mark "Alice ebook" read', exact: true }),
      ).toBeHidden();
    }
    expect(unread()).toBe(1);
    await expect(page.getByRole('button', { name: 'Mark all read', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filter: All', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Unread (1)', exact: true })).toBeVisible();
  });
}
