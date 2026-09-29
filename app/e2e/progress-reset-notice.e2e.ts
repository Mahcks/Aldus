import { expect, test } from '@playwright/test';

test('the progress reset notice clears after leaving the book page', async ({ page }) => {
  const width = 1440;
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let resets = 0;
  let fail = false;
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path.endsWith('/title-requests/page')) json = { items: [], has_more: false };
    if (path === '/setup/status') json = { available: false };
    if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
    if (path === '/libraries/library')
      json = { id: 'library', name: 'Books', role: 'reader', effective: true };
    if (path === '/works/book')
      json = {
        id: 'book',
        library_id: 'library',
        title: 'Treasure Island',
        author: 'Robert Louis Stevenson',
        reading_status: 'reading',
        in_progress: !resets,
        completion_percent: resets ? 0 : 45,
        genre_tags: [],
        subject_values: [],
        narrators: [],
        active_seconds: 100,
      };
    if (path === '/works/book/representations')
      json = [{ id: 'ebook', work_id: 'book', kind: 'epub', label: 'Ebook' }];
    if (path === '/libraries/library/representations/ebook/media')
      json = [
        { id: 'epub', representation_id: 'ebook', kind: 'epub', original_filename: 'book.epub' },
      ];
    if (path === '/works/book/progress')
      json = resets
        ? { alignment_id: '', segment_id: '', offset: 0, revision: 5, reset: true }
        : { alignment_id: 'alignment', segment_id: 'segment', offset: 500, revision: 4 };
    if (path === '/works/book/preference') json = null;
    if (path === '/works/book/reading-session') json = null;
    if (path === '/works/book/progress/reset') {
      resets++;
      const body = route.request().postDataJSON();
      requests.push(body.request_id);
      expect(body.expected_epoch).toBe(0);
      if (fail) {
        fail = false;
        await route.fulfill({ status: 503, body: 'Server temporarily unavailable.' });
        return;
      }
      json = {
        owner: {
          work_id: 'book',
          device_id: body.device_id,
          label: 'Web',
          platform: 'web',
          epoch: 1,
          idle_seconds: 0,
          updated_at: '',
        },
        reset_epoch: 1,
        progress: { alignment_id: '', segment_id: '', offset: 0, revision: 5, reset: true },
        representation_states: [],
      };
    }
    await route.fulfill({ json });
  });
  await page.goto('/work/book');
  await expect(page.getByText('45% complete', { exact: false })).toBeVisible();
  await page.screenshot({ path: '../artifacts/progress-reset/1440-start-over-link.png' });
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start “Treasure Island” over?' });
  await dialog.getByRole('button', { name: 'Start over', exact: true }).click();
  await expect(dialog).toBeHidden();
  const notice = page.getByText('Reading progress reset. You can start from the beginning.');
  await expect(notice).toBeVisible();
  expect(resets).toBe(1);

  // Opening the reader and coming back is a new visit: the confirmation is gone.
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await expect(page).toHaveURL(/\/consume\/book/);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  expect(requests).toHaveLength(1);
});
