import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`activity unified feed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const now = new Date().toISOString();
    const notifications: Record<string, unknown>[] = [
      {
        id: 'title-request:request-0:audiobook:downloading',
        kind: 'download_started',
        title: 'Your audiobook is downloading',
        body: 'Alice’s Adventures in Wonderland · Audiobook',
        action_url: '/activity',
        created_at: now,
      },
      {
        id: 'title-request:request-9:ebook:approval-needed',
        kind: 'acquisition.approval_needed',
        title: 'Book request needs approval',
        body: 'The Secret Garden · Ebook',
        action_url: '/acquisitions',
        created_at: now,
      },
    ];
    const unreadTotal = () => notifications.filter((item) => !item.read_at).length;
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace('/api/v1', '');
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
        json = { unread_count: unreadTotal(), items: notifications };
      if (path === '/me/notifications/unread-count') json = { unread_count: unreadTotal() };
      if (req.method() === 'POST' && /^\/me\/notifications\/[^/]+\/read$/.test(path)) {
        const id = path.split('/')[3];
        const item = notifications.find((candidate) => candidate.id === id);
        if (item) item.read_at = now;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (path === '/me/notifications/read-all' && req.method() === 'POST') {
        for (const item of notifications) item.read_at = now;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (path === '/libraries/family/title-requests/page' && Array.isArray(json))
        json = { items: json };
      await route.fulfill({ json });
    });
    await page.goto('/activity');

    // Default "All" view: needs-approval and personal requests share one page, no tabs.
    await expect(page.getByRole('button', { name: 'Filter: All', exact: true })).toBeVisible();
    await expect(page.getByText('Needs your approval', { exact: true })).toBeVisible();
    await expect(page.getByText('The Secret Garden', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
    await expect(page.getByText('Alice’s Adventures in Wonderland', { exact: true })).toBeVisible();
    await expect(page.getByText('Treasure Island', { exact: true })).toBeVisible();
    await expect(page.getByText('Through the Looking-Glass', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Cancel Alice’s Adventures in Wonderland, Audiobook',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText('Downloading to your library.', { exact: true })).toBeVisible();
    const markAliceRead = page.getByRole('button', {
      name: 'Mark "Alice’s Adventures in Wonderland audiobook" read',
      exact: true,
    });
    await expect(markAliceRead).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-all.png` });

    // The request's own event timeline still works, unchanged.
    const viewAliceUpdates = page.getByRole('button', {
      name: 'View updates for Alice’s Adventures in Wonderland, Audiobook',
      exact: true,
    });
    await viewAliceUpdates.click();
    await expect(
      page.getByText(
        width === 1024 ? '40 unsuccessful attempts' : '40 checks for a matching release',
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: 'Hide updates for Alice’s Adventures in Wonderland, Audiobook',
        exact: true,
      })
      .click();

    // Marking one row read is independent of navigating — stays on Activity, badge drops immediately.
    await markAliceRead.click();
    await expect(markAliceRead).toHaveCount(0);
    await expect(page).toHaveURL(/\/activity/);
    await expect(page.getByRole('button', { name: 'Filter: All', exact: true })).toBeVisible();

    // One filter control, not a second tab row: open it, switch to Ready.
    await page.getByRole('button', { name: 'Filter: All', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Filter activity' })).toBeVisible();
    await page.getByRole('radio', { name: 'Ready', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Filter: Ready', exact: true })).toBeVisible();
    await expect(page.getByText('Through the Looking-Glass', { exact: true })).toBeVisible();
    await expect(page.getByText('Alice’s Adventures in Wonderland', { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Listen to Through the Looking-Glass now', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-ready.png` });

    await page.getByRole('button', { name: 'Filter: Ready', exact: true }).click();
    await page.getByRole('radio', { name: 'History', exact: true }).click();
    await expect(page.getByText('Treasure Island', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Find Treasure Island again', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-activity-history.png` });

    await page.getByRole('button', { name: 'Filter: History', exact: true }).click();
    await page.getByRole('radio', { name: 'Needs approval (1)', exact: true }).click();
    await expect(page.getByText('The Secret Garden', { exact: true })).toBeVisible();
    await expect(page.getByText('Treasure Island', { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-activity-needs-approval.png`,
    });

    // Mark all read clears the remaining admin item too; badge and filter label agree.
    await page.getByRole('button', { name: 'Filter: Needs approval (1)', exact: true }).click();
    await page.getByRole('radio', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mark all read', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Filter: All', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Unread', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Unread', exact: true }).click();
    await expect(page.getByText('You’re all caught up', { exact: true })).toBeVisible();
  });
}
