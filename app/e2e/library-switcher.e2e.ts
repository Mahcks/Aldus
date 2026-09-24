import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`libraries index and switcher at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const now = new Date().toISOString();
    const libraries: Record<string, unknown>[] = [
      {
        id: 'public',
        name: 'Public',
        role: 'owner',
        exclusive: false,
        effective: true,
        can_request_acquisitions: true,
        can_bypass_acquisition_approval: true,
        can_advanced_acquisition_request: true,
        primary: true,
        work_count: 12,
        member_count: 3,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'kids',
        name: 'Kids',
        role: 'owner',
        exclusive: true,
        effective: true,
        can_request_acquisitions: true,
        can_bypass_acquisition_approval: true,
        can_advanced_acquisition_request: true,
        primary: false,
        work_count: 4,
        member_count: 1,
        created_at: now,
        updated_at: now,
      },
    ];
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'alex', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = libraries;
      const libraryMatch = /^\/libraries\/([^/]+)$/.exec(path);
      if (libraryMatch) {
        const library = libraries.find((item) => item.id === libraryMatch[1]);
        json = library ?? {};
      }
      if (/^\/libraries\/[^/]+\/members$/.test(path)) json = [];
      if (/^\/libraries\/[^/]+\/sources$/.test(path)) json = [];
      if (/^\/libraries\/[^/]+\/acquisition-policy$/.test(path))
        json = {
          library_id: 'public',
          max_ebook_bytes: 0,
          max_audiobook_bytes: 0,
          allowed_ebook_extensions: [],
          allowed_audiobook_extensions: [],
          preferred_language: '',
          allow_abridged: false,
          max_active_requests: 5,
        };
      if (path === '/works') json = { items: [], has_more: false };
      const primaryMatch = /^\/libraries\/([^/]+)\/primary$/.exec(path);
      if (primaryMatch && req.method() === 'PUT') {
        for (const item of libraries) item.primary = item.id === primaryMatch[1];
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.fulfill({ json });
    });

    // Index: settings gear, primary star, and real counts instead of an empty-feeling full-width row.
    await page.goto('/libraries');
    await expect(page.getByText('Public', { exact: true })).toBeVisible();
    await expect(page.getByText('12 books · 3 members', { exact: true })).toBeVisible();
    await expect(page.getByText('4 books · 1 member', { exact: true })).toBeVisible();
    await expect(page.getByText('· Restricted access', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Public is your primary library', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage Public', exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-libraries-index.png` });

    // Starring another library from the index moves primary immediately.
    await page.getByRole('button', { name: 'Make Kids your primary library', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Kids is your primary library', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Make Public your primary library', exact: true }),
    ).toBeVisible();

    // The gear opens a local quick-menu without navigating away from the index.
    await page.getByRole('button', { name: 'Manage Public', exact: true }).click();
    await expect(page).toHaveURL(/\/libraries$/);
    await expect(page.getByRole('heading', { name: 'Manage Public' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Members', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sources', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Acquisition policy', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Library settings', exact: true })).toBeVisible();
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-libraries-quick-menu.png`,
    });

    // Picking "Sources" from the quick-menu goes straight to the standalone
    // sources page, bypassing the library detail page entirely.
    await page.getByRole('button', { name: 'Sources', exact: true }).click();
    await expect(page).toHaveURL(/\/sources\?libraryId=public/);

    // The page title is now the switcher.
    await page.goto('/library/public');

    // The header is just the management gear and "Add work" — no more
    // Members/Sources/Acquisition policy buttons cluttering the top row.
    await expect(
      page.getByRole('button', { name: 'Library management', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add work', exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-library-detail-header.png` });

    const switcherTitle = page.getByRole('button', { name: /Switch library, currently Public/ });
    await expect(switcherTitle).toBeVisible();
    await switcherTitle.click();
    await expect(page.getByRole('heading', { name: 'Switch library' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kids, owner', exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-library-switcher.png` });

    // Kids became primary from the index step above; setting it back from inside
    // the switcher works too, without navigating away.
    await page
      .getByRole('button', { name: 'Make Public your primary library', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Public is your primary library', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Switch library' })).toBeVisible();

    // Switching libraries navigates; "Manage all libraries" goes back to the index.
    await page.getByRole('button', { name: 'Kids, owner', exact: true }).click();
    await expect(page).toHaveURL(/\/library\/kids/);
    await page.getByRole('button', { name: /Switch library, currently Kids/ }).click();
    await page.getByRole('button', { name: 'Manage all libraries', exact: true }).click();
    await expect(page).toHaveURL(/\/libraries/);
  });
}
