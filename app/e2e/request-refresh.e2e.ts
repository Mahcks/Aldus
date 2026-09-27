import { expect, test } from '@playwright/test';

test('request filters apply to delayed data, recover offline and stop polling completed requests', async ({
  page,
}) => {
  let calls = 0;
  let fail = true;
  let releaseRequests: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    releaseRequests = resolve;
  });
  const stamp = new Date().toISOString();
  const title = (state: string) => ({
    id: state,
    library_id: 'family',
    requested_by: 'reader',
    title: state === 'failed' ? 'Past request' : 'Active request',
    created_at: stamp,
    updated_at: stamp,
    formats: [{ format: 'ebook', state, updated_at: stamp }],
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
    if (path === '/setup/status') json = { available: false };
    if (path === '/libraries') json = [{ id: 'family', name: 'Family' }];
    if (path === '/me/notifications') json = { items: [], unread_count: 0 };
    if (path === '/me/notifications/unread-count') json = { count: 0 };
    if (path === '/libraries/family/title-requests/page') {
      expect(url.searchParams.get('filter')).toBe('all');
      calls++;
      if (fail) {
        await route.abort('failed');
        return;
      }
      await delayed;
      json = { items: [title('failed')] };
    }
    await route.fulfill({ json });
  });
  await page.goto('/activity');
  await expect(page.getByRole('button', { name: 'Retry requests', exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry requests', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByRole('button', { name: 'Filter: All', exact: true }).click();
  await page.getByRole('radio', { name: 'History', exact: true }).click();
  releaseRequests();
  await expect(page.getByText('Past request', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter: History', exact: true })).toBeVisible();
  await expect(page.getByText('Active request', { exact: true })).toHaveCount(0);
  await page.clock.install();
  const before = calls;
  await page.clock.fastForward(30_000);
  expect(calls).toBe(before);
  await expect(page.getByText('Past request', { exact: true })).toBeVisible();
});
