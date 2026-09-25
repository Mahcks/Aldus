import { expect, test } from '@playwright/test';

test('activity overlaps library reads, settles failures and preserves library order', async ({
  page,
}) => {
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstCalls = 0;
  let secondCalls = 0;
  let failSecond = true;
  let delayRefresh = false;
  let releaseRefresh!: () => void;
  const refreshPending = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const stamp = new Date().toISOString();
  const request = (library: string) => ({
    id: library,
    library_id: library,
    requested_by: 'reader',
    title: `${library} book`,
    created_at: stamp,
    updated_at: stamp,
    formats: [{ format: 'ebook', state: 'failed', updated_at: stamp }],
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
    if (path === '/setup/status') json = { available: false };
    if (path === '/libraries')
      json = [
        { id: 'first', name: 'First' },
        { id: 'second', name: 'Second' },
      ];
    if (path === '/me/notifications') json = { items: [], unread_count: 0 };
    if (path === '/me/notifications/unread-count') json = { unread_count: 0 };
    if (path === '/libraries/first/title-requests/page') {
      firstCalls++;
      if (firstCalls === 1) await firstPending;
      if (delayRefresh) await refreshPending;
      json = { items: [request('first')] };
    }
    if (path === '/libraries/second/title-requests/page') {
      secondCalls++;
      if (failSecond) {
        await route.abort('failed');
        return;
      }
      json = { items: [request('second')] };
    }
    await route.fulfill({ json });
  });
  await page.goto('/activity');
  // The second library starts while the first is still blocked.
  await expect.poll(() => secondCalls).toBe(1);
  expect(firstCalls).toBe(1);
  await expect(page.getByRole('button', { name: 'Retry requests', exact: true })).toHaveCount(0);
  releaseFirst();
  await expect(page.getByRole('button', { name: 'Retry requests', exact: true })).toBeVisible();
  // Partial data from a failed refresh must never replace a complete snapshot.
  await expect(page.getByText('first book', { exact: true })).toHaveCount(0);
  failSecond = false;
  await page.getByRole('button', { name: 'Retry requests', exact: true }).click();
  await expect(page.getByText('first book', { exact: true })).toBeVisible();
  await expect(page.getByText('second book', { exact: true })).toBeVisible();
  const first = await page.getByText('first book', { exact: true }).boundingBox();
  const second = await page.getByText('second book', { exact: true }).boundingBox();
  expect(first!.y).toBeLessThan(second!.y);

  delayRefresh = true;
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.goBack();
  await expect.poll(() => firstCalls).toBe(3);
  await expect(page.getByText('first book', { exact: true })).toBeVisible();
  releaseRefresh();
});

test('activity ignores requests completed after losing focus', async ({ page }) => {
  let releaseStale!: () => void;
  const stalePending = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  let calls = 0;
  const stamp = new Date().toISOString();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
    if (path === '/setup/status') json = { available: false };
    if (path === '/libraries') json = [{ id: 'family', name: 'Family' }];
    if (path === '/me/notifications') json = { items: [], unread_count: 0 };
    if (path === '/me/notifications/unread-count') json = { unread_count: 0 };
    if (path === '/libraries/family/title-requests/page') {
      const attempt = ++calls;
      if (attempt === 1) await stalePending;
      json = {
        items: [
          {
            id: 'request',
            library_id: 'family',
            requested_by: 'reader',
            title: attempt === 1 ? 'Stale book' : 'Current book',
            created_at: stamp,
            updated_at: stamp,
            formats: [{ format: 'ebook', state: 'failed', updated_at: stamp }],
          },
        ],
      };
    }
    await route.fulfill({ json });
  });
  await page.goto('/activity');
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.goBack();
  await expect(page.getByText('Current book', { exact: true })).toBeVisible();
  const staleResponse = page.waitForResponse((response) =>
    response.url().includes('/title-requests/page'),
  );
  releaseStale();
  await staleResponse;
  await expect(page.getByText('Stale book', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Current book', { exact: true })).toBeVisible();
});
