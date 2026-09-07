import { expect, test } from '@playwright/test';

test('request filters reject late responses, recover offline and stop polling history', async ({
  page,
}) => {
  let activeCalls = 0;
  let historyCalls = 0;
  let failHistory = true;
  let releaseActive: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    releaseActive = resolve;
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
      if (url.searchParams.get('filter') === 'active') {
        activeCalls++;
        if (activeCalls === 1) await delayed;
        json = { items: [title('wanted')] };
      } else {
        historyCalls++;
        if (failHistory) {
          await route.abort('failed');
          return;
        }
        json = { items: [title('failed')] };
      }
    }
    await route.fulfill({ json });
  });
  await page.goto('/activity');
  await expect.poll(() => activeCalls).toBe(1);
  await page.getByRole('radio', { name: 'History', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry requests', exact: true })).toBeVisible();
  failHistory = false;
  await page.getByRole('button', { name: 'Retry requests', exact: true }).click();
  await expect(page.getByText('Past request', { exact: true })).toBeVisible();
  releaseActive();
  await expect(page.getByText('Active request', { exact: true })).toHaveCount(0);
  await page.clock.install();
  const calls = historyCalls;
  await page.clock.fastForward(30_000);
  expect(historyCalls).toBe(calls);
  await expect(page.getByText('Past request', { exact: true })).toBeVisible();
});
