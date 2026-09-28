import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`bulk missing metadata preserves existing fields at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const current = {
      title: 'The Time Machine',
      author: 'H. G. Wells',
      description: 'My description.',
      isbn: '',
      publisher: '',
      language: '',
      subjects: [],
      first_publish_year: 0,
      cover_url: '',
    };
    const book = {
      id: 'book',
      library_id: 'library',
      ...current,
      readable: true,
      missing_metadata: ['cover'],
    };
    let saved = false;
    let releaseLookup = () => {};
    const lookupReady = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    let calls = 0;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', admin: true, display_name: 'Owner' };
      if (path === '/setup/status') json = { available: false, demo_available: false };
      if (path === '/libraries/library')
        json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
      if (path === '/works')
        json = {
          items: [book, { ...book, id: 'other', title: 'Unselected book' }],
          has_more: false,
          offset: 0,
        };
      if (path === '/works/book') json = book;
      if (path === '/works/book/metadata/candidates') {
        if (width === 1440) await lookupReady;
        calls++;
        json = { current, candidates: [{ work_id: 'OL1W', edition_id: '', values: current }] };
      }
      if (path === '/works/book/metadata/editions')
        json = {
          current,
          candidates: [
            {
              work_id: 'OL1W',
              edition_id: '',
              values: {
                ...current,
                description: 'Replacement must not be used.',
                subjects: ['Science fiction'],
              },
            },
          ],
        };
      if (path === '/works/book/metadata/apply') {
        const body = route.request().postDataJSON();
        expect(body.fields).toEqual(['subjects']);
        expect(body.expected.description).toBe('My description.');
        saved = true;
        await route.fulfill({ status: 204 });
        return;
      }
      if (path.startsWith('/works/other/')) throw new Error('Unselected book was processed');
      await route.fulfill({ json });
    });
    await page.goto('/library/library/metadata');
    await page.getByRole('button', { name: 'Fill missing details', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill missing details', exact: true });
    await expect(
      dialog.getByRole('button', { name: 'Fill missing details for 0 books', exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole('checkbox', {
        name: width === 1440 ? 'Select all books on this page' : 'The Time Machine',
        exact: true,
      })
      .click();
    await page.screenshot({
      path: `../artifacts/metadata-bulk/${width}-selection.png`,
      animations: 'disabled',
    });
    await dialog
      .getByRole('button', {
        name:
          width === 1440 ? 'Fill missing details for 2 books' : 'Fill missing details for 1 book',
        exact: true,
      })
      .click();
    if (width === 1440) {
      await dialog.getByRole('button', { name: 'Stop after this book', exact: true }).click();
      releaseLookup();
      await expect(
        dialog.getByText('Stopped. Completed changes were kept.', { exact: true }),
      ).toBeVisible();
    }
    await expect(dialog.getByText('Filled: subjects.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    expect(saved).toBe(true);
    expect(calls).toBe(1);
    await page.screenshot({
      path: `../artifacts/metadata-bulk/${width}-results.png`,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}
