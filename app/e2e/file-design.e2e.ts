import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`file details and populated sync choices at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const editions = [
      { id: 'epub', work_id: 'book', kind: 'epub', label: 'Illustrated edition' },
      {
        id: 'audio',
        work_id: 'book',
        kind: 'audio',
        label: 'Unabridged narration',
        narrators: ['Jane Reader'],
      },
    ];
    const files = (edition: string) =>
      [0, 1].map((index) => ({
        id: `${edition}-${index}`,
        representation_id: edition,
        kind: edition,
        original_filename: `${edition === 'epub' ? 'Alice illustrated' : 'Alice unabridged narration'} ${index + 1}.${edition === 'epub' ? 'epub' : 'm4b'}`,
        size_bytes: 4194304,
        created_at: '2026-09-01T12:00:00Z',
        sha256: 'test-file-hash',
      }));
    let updates = 0;
    const cover =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#304e43"/><rect x="12" y="12" width="176" height="276" fill="none" stroke="#f8edce"/><text x="100" y="125" text-anchor="middle" fill="#f8edce" font-size="24">ALICE</text><text x="100" y="165" text-anchor="middle" fill="#f8edce" font-size="12">Illustrated edition</text></svg>',
      );
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'admin', username: 'alex', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries/family') json = { id: 'family', name: 'Family', role: 'owner' };
      if (path === '/works/book')
        json = {
          id: 'book',
          library_id: 'family',
          title: 'Alice’s Adventures in Wonderland',
          author: 'Lewis Carroll',
          genre_tags: [],
          subject_values: [],
          cover_url: cover,
          cover_fit: 'cover',
          cover_focal_x: 50,
          cover_focal_y: 50,
          generated_cover_style: 'classic',
          generated_cover_tone: 0,
          generated_cover_layout: 'center',
        };
      if (path === '/works/book/alignment-jobs')
        json = [
          {
            id: 'job',
            state: 'failed',
            epub_media_id: 'epub-0',
            audio_media_id: 'audio-0',
            created_at: '2026-09-01T12:00:00Z',
            error: 'worker timeout',
          },
        ];
      if (path === '/works/book/representations') json = editions;
      for (const edition of editions) {
        if (path === `/representations/${edition.id}`) {
          if (route.request().method() === 'PATCH') {
            Object.assign(edition, route.request().postDataJSON());
            updates++;
          }
          json = edition;
        }
        if (path === `/libraries/family/representations/${edition.id}/media`)
          json = files(edition.id);
      }
      await route.fulfill({ json });
    });
    await page.goto('/representation/audio');
    const name = page.getByRole('textbox', { name: 'Edition name', exact: true });
    await expect(name).toHaveValue('Unabridged narration');
    await expect(
      page.getByRole('button', { name: 'Delete file entry', exact: true }),
    ).toBeDisabled();
    await name.fill('Family narration');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => updates).toBe(1);
    await expect(page.getByText('Family narration', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-file-details.png` });
    await page.goto('/work/book/manage?tab=files');
    await expect(page.getByText('Reading editions', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-populated-files.png` });
    await page.getByRole('tab', { name: 'Sync', exact: true }).click();
    await expect(page.getByText(/Sync reached the server’s time limit/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry sync', exact: true })).toBeEnabled();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-sync-timeout.png` });
    const second = page.getByRole('radio', { name: 'Alice illustrated 2.epub', exact: true });
    await second.focus();
    await page.keyboard.press('Space');
    await expect(second).toBeChecked();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-populated-sync.png` });
    await page.getByRole('button', { name: 'Show sync history', exact: true }).click();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-sync-history.png` });
    const runningJob = {
      id: 'job',
      state: 'processing',
      stage: 'transcribing',
      epub_media_id: 'epub-0',
      audio_media_id: 'audio-0',
      created_at: new Date(Date.now() - 120000).toISOString(),
      started_at: new Date(Date.now() - 120000).toISOString(),
    };
    let unavailable = false;
    await page.route('**/works/book/alignment-jobs', (route) =>
      unavailable
        ? route.fulfill({ status: 503, body: 'unavailable' })
        : route.fulfill({ json: [runningJob] }),
    );
    await page.reload();
    await expect(page.getByText('Transcribing the narration', { exact: true })).toBeVisible();
    await expect(page.getByText('2 min elapsed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel sync', exact: true })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Show sync history', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-sync-progress.png` });
    unavailable = true;
    await expect(page.getByText(/Cannot refresh progress/)).toBeVisible({ timeout: 15000 });
    unavailable = false;
    runningJob.stage = 'validating';
    await expect(page.getByText('Checking and saving the alignment', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    runningJob.state = 'ready';
    await expect(
      page.getByText('Readers can switch between reading and listening in sync.', { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Cancel sync', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Artwork', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Edit fallback design', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-custom-artwork-preview.png`,
    });
    await page.getByRole('button', { name: 'Save artwork', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-custom-artwork.png` });
    await page.getByRole('button', { name: 'Edit fallback design', exact: true }).click();
    await expect(page.getByText('Fallback cover', { exact: true })).toBeVisible();
    runningJob.state = 'processing';
    runningJob.stage = 'matching_text';
    await page.goto('/work/book');
    await expect(page.getByText('Matching narration to the ebook', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'View sync details', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-book-sync-progress.png` });
    await page.getByRole('button', { name: 'View sync details', exact: true }).click();
    await expect(page).toHaveURL(/\/work\/book\/manage\?tab=sync$/);
    await expect(page.getByText('Read + Listen sync', { exact: true })).toBeVisible();
  });
}
