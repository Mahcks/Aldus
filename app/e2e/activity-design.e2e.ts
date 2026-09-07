import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`activity request states and updates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const now = new Date().toISOString();
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'alex', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'reader' }];
      if (path === '/libraries/family/title-requests/page')
        json = ['downloading', 'failed', 'available'].map((state, index) => ({
          id: `request-${index}`,
          library_id: 'family',
          requested_by: 'reader',
          work_id: state === 'available' ? 'book' : '',
          title: [
            'Alice’s Adventures in Wonderland',
            'Treasure Island',
            'Through the Looking-Glass',
          ][index],
          author: 'Family library',
          updated_at: now,
          formats: [{ format: 'audiobook', state, updated_at: now }],
        }));
      if (path === '/libraries/family/title-requests/request-0/events') {
        const event = (event_type: string, state: string) => ({
          event_type,
          state,
          format: 'audiobook',
          created_at: now,
        });
        json = [
          ...Array.from({ length: 40 }, () => [
            event(width === 1024 ? 'submission_failed' : 'no_match', 'awaiting_release'),
            event('search_started', 'searching'),
          ]).flat(),
          event('search_failed', 'awaiting_release'),
          event('search_recovered', 'awaiting_release'),
          event('release_failed', 'awaiting_release'),
          event('download_started', 'downloading'),
          event('approved', 'approved'),
          event('requested', 'pending_approval'),
        ];
      }
      if (path === '/me/notifications')
        json = {
          unread_count: 1,
          items: [
            {
              id: 'title-request:request-0:audiobook:downloading',
              kind: 'download_started',
              title: 'Your audiobook is downloading',
              body: 'Alice’s Adventures in Wonderland · Audiobook',
              created_at: now,
            },
          ],
        };
      if (path === '/me/notifications/unread-count') json = { count: 1 };
      if (path === '/libraries/family/title-requests/page' && Array.isArray(json))
        json = { items: json };
      await route.fulfill({ json });
    });
    await page.goto('/activity');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByText('Audiobook', { exact: true })).toBeVisible();
    await expect(page.getByText('Downloading', { exact: true })).toBeVisible();
    await expect(page.getByText('Downloading to your library.', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-active.png` });
    await page.getByRole('button', { name: 'View updates', exact: true }).click();
    await expect(
      page.getByText(
        width === 1024 ? '40 unsuccessful attempts' : '40 checks for a matching release',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('Submitted for approval.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-watch.png` });
    await page.getByRole('button', { name: 'Show older updates', exact: true }).click();
    await expect(page.getByText('Submitted for approval.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show fewer updates', exact: true }).click();
    await expect(page.getByText('Submitted for approval.', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Hide updates', exact: true }).click();
    await page.getByRole('radio', { name: 'History', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Find again', exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-history.png` });
    await page.getByRole('radio', { name: 'Ready', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Updates (1)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View request', exact: true })).toBeVisible();
    await expect(page.getByText('Your audiobook is downloading', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-updates.png` });
  });
}
