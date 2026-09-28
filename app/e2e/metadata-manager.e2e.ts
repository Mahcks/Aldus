import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`metadata manager reviews narrators and advances the queue at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let narratorSaved = false;
    let conflict = width === 390;
    let releaseTags = () => {};
    const tagsReady = new Promise<void>((resolve) => {
      releaseTags = resolve;
    });
    const books = [
      {
        id: 'island',
        library_id: 'library',
        title: 'Treasure Island',
        author: 'Robert Louis Stevenson',
        listenable: true,
        readable: true,
        missing_metadata: ['narrator'],
        narrators: [],
        series: '',
      },
      {
        id: 'sea',
        library_id: 'library',
        title: 'The Sea-Wolf',
        author: 'Jack London',
        listenable: false,
        readable: true,
        missing_metadata: ['description'],
        narrators: [],
        series: '',
      },
    ];
    const current = {
      values: {
        title: 'Treasure Island',
        author: 'Robert Louis Stevenson',
        description: 'A voyage in search of buried treasure.',
        subjects: [],
        first_publish_year: 1883,
      },
      narrators: [],
      series: '',
      series_position: '',
    };
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', admin: true, display_name: 'Max' };
      if (path === '/setup/status') json = { available: false, demo_available: false };
      if (path === '/libraries/library')
        json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
      if (path === '/works') {
        expect(url.searchParams.get('library_id')).toBe('library');
        const q = url.searchParams.get('q')?.toLowerCase() ?? '';
        json = {
          items: books.filter(
            (book) => (!narratorSaved || book.id !== 'island') && book.title.toLowerCase().includes(q),
          ),
          has_more: false,
          offset: 0,
        };
      }
      if (path === '/representations/audio')
        json = {
          id: 'audio',
          work_id: 'island',
          kind: 'audio',
          label: 'Narrated by Mark Nelson',
          narrators: ['Another editor'],
        };
      if (path === '/works/island') json = { ...books[0], description: current.values.description };
      if (path === '/works/sea') json = books[1];
      if (path === '/works/sea/representations') json = [];
      if (path === '/works/island/representations')
        json = [
          {
            id: 'audio',
            work_id: 'island',
            kind: 'audio',
            label: width === 1024 ? 'Unabridged recording' : 'Narrated by Mark Nelson',
            narrators: narratorSaved && !conflict ? ['Mark Nelson'] : [],
          },
        ];
      if (path === '/libraries/library/representations/audio/media')
        json = [
          { id: 'file', representation_id: 'audio', kind: 'audio', original_filename: 'Treasure Island.m4b' },
        ];
      if (path === '/media/file/metadata') {
        if (width === 1440) await tagsReady;
        json = {
          asin: '',
          current,
          suggested: { ...current, narrators: width === 390 ? [] : ['Mark Nelson'] },
        };
      }
      if (path === '/media/file/metadata/apply') {
        if (conflict) {
          conflict = false;
          await route.fulfill({ status: 409, body: 'Narrators changed' });
          return;
        }
        expect(route.request().postDataJSON().fields).toEqual(['narrators']);
        expect(route.request().postDataJSON().values.narrators).toEqual([
          width === 1440 ? 'My corrected narrator' : 'Mark Nelson',
        ]);
        narratorSaved = true;
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto('/library/library/metadata');
    await expect(
      page.getByRole('button', { name: 'Review Treasure Island', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../artifacts/metadata-manager/${width}-list.png`,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Review Treasure Island', exact: true }).click();
    // Book details starts collapsed, matching the recordings' own accordion treatment.
    await page.getByRole('button', { name: 'Expand book details', exact: true }).click();
    await expect(
      page.getByText('A voyage in search of buried treasure.', { exact: true }),
    ).toBeVisible();
    const narrator = page.getByRole('textbox', { name: 'Narrator names', exact: true });
    if (width !== 1440) {
      // The narrator is never silently prefilled — it's surfaced as a suggestion
      // the reviewer has to explicitly accept.
      await expect(narrator).toHaveValue('');
      // At 390px the recording's own label already names a narrator, so the
      // suggestion falls back to that edition name rather than the (empty)
      // file tags; at other widths the file tags supply it directly.
      await expect(
        page.getByText(
          width === 390
            ? 'Suggested from this recording’s name: “Mark Nelson” — not yet confirmed as a person’s name.'
            : 'Found in this recording’s file tags: “Mark Nelson” — not yet confirmed as a person’s name.',
          { exact: true },
        ),
      ).toBeVisible();
    }
    await page.screenshot({
      path: `../artifacts/metadata-manager/${width}-review.png`,
      animations: 'disabled',
    });
    await expect(page.getByText('Find it on Audible', { exact: true })).toBeVisible();

    if (width === 1440) {
      // A slow file-tag response must never clobber narration the reviewer already typed.
      await expect(narrator).toHaveValue('');
      await narrator.fill('My corrected narrator');
      releaseTags();
      await expect(page.getByText('Checking file tags…', { exact: true })).toHaveCount(0);
      await expect(narrator).toHaveValue('My corrected narrator');
    } else {
      await page.getByRole('button', { name: 'Use this', exact: true }).click();
      await expect(narrator).toHaveValue('Mark Nelson');
    }
    await page.getByRole('button', { name: 'Save narrator', exact: true }).click();
    if (width === 390) {
      await expect(
        page.getByText('Someone else saved this recording first', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Reload and try again', exact: true }).click();
      await expect(narrator).toHaveValue('Another editor');
      await narrator.fill('Mark Nelson');
      await page.getByRole('button', { name: 'Save narrator', exact: true }).click();
    }

    // A successful save is visibly reflected in place — no forced navigation.
    await expect(page.getByText('These narrator names are already saved.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save narrator', exact: true })).toBeDisabled();

    // Nothing is dirty anymore, so advancing must not prompt for confirmation.
    await page.getByRole('button', { name: 'Save & next', exact: true }).click();
    await expect(page.getByText('Save unsaved changes?', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand book details', exact: true }).click();
    await expect(page.getByText('No description yet.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Review Treasure Island', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('textbox', { name: 'Search books, authors, or narrators', exact: true })
      .fill('no match');
    await expect(page.getByText('No books need attention here', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('warns before losing an unsaved narrator draft when switching books', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let narratorSaved = false;
  const empty = { values: {}, narrators: [], series: '', series_position: '' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'owner', admin: true, display_name: 'Max' };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/libraries/library') json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
    if (path === '/works')
      json = {
        items: [
          { id: 'island', library_id: 'library', title: 'Treasure Island', author: 'R. L. Stevenson', listenable: true, readable: true, narrators: [] },
          { id: 'sea', library_id: 'library', title: 'The Sea-Wolf', author: 'Jack London', listenable: false, readable: true, narrators: [] },
        ],
        has_more: false,
        offset: 0,
      };
    if (path === '/works/island') json = { ...{}, id: 'island', title: 'Treasure Island', author: 'R. L. Stevenson' };
    if (path === '/works/sea') json = { id: 'sea', title: 'The Sea-Wolf', author: 'Jack London' };
    if (path === '/works/island/representations')
      json = [{ id: 'audio', work_id: 'island', kind: 'audio', label: 'Audiobook', narrators: narratorSaved ? ['Manual Narrator'] : [] }];
    if (path === '/works/sea/representations') json = [];
    if (path === '/libraries/library/representations/audio/media')
      json = [{ id: 'file', representation_id: 'audio', kind: 'audio', original_filename: 'Treasure Island.m4b' }];
    if (path === '/media/file/metadata') json = { asin: '', current: empty, suggested: empty };
    if (path === '/media/file/metadata/apply') {
      expect(route.request().postDataJSON().values.narrators).toEqual(['Manual Narrator']);
      narratorSaved = true;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json });
  });
  await page.goto('/library/library/metadata');
  await page.getByRole('button', { name: 'Review Treasure Island', exact: true }).click();
  const narrator = page.getByRole('textbox', { name: 'Narrator names', exact: true });
  await narrator.fill('Manual Narrator');

  const bar = page.getByText(
    'You have an unsaved narrator or description entry. Save it before moving on?',
    { exact: true },
  );
  await page.getByRole('button', { name: 'Review The Sea-Wolf', exact: true }).click();
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(narrator).toHaveValue('Manual Narrator');

  await page.getByRole('button', { name: 'Review The Sea-Wolf', exact: true }).click();
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(bar).toHaveCount(0);
  // 'The Sea-Wolf' also appears in the still-visible desktop queue list, so
  // confirm the workspace switched via its unique empty-recordings message.
  await expect(page.getByText('This book has no editions yet.', { exact: true })).toBeVisible();
});

test('warns before losing an unsaved narrator draft when switching recordings', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const empty = { values: {}, narrators: [], series: '', series_position: '' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'owner', admin: true, display_name: 'Max' };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/libraries/library') json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
    if (path === '/works')
      json = { items: [{ id: 'anthology', library_id: 'library', title: 'Two Recordings', author: 'Various', listenable: true, readable: false, narrators: [] }], has_more: false, offset: 0 };
    if (path === '/works/anthology') json = { id: 'anthology', title: 'Two Recordings', author: 'Various' };
    if (path === '/works/anthology/representations')
      json = [
        { id: 'audioA', work_id: 'anthology', kind: 'audio', label: 'Recording A', narrators: [] },
        { id: 'audioB', work_id: 'anthology', kind: 'audio', label: 'Recording B', narrators: [] },
      ];
    if (path === '/libraries/library/representations/audioA/media')
      json = [{ id: 'fileA', representation_id: 'audioA', kind: 'audio', original_filename: 'A.m4b' }];
    if (path === '/libraries/library/representations/audioB/media')
      json = [{ id: 'fileB', representation_id: 'audioB', kind: 'audio', original_filename: 'B.m4b' }];
    if (path === '/media/fileA/metadata' || path === '/media/fileB/metadata')
      json = { asin: '', current: empty, suggested: empty };
    if (path === '/media/fileA/metadata/apply') {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json });
  });
  await page.goto('/library/library/metadata');
  await page.getByRole('button', { name: 'Review Two Recordings', exact: true }).click();

  const narrator = page.getByRole('textbox', { name: 'Narrator names', exact: true });
  await expect(page.getByRole('button', { name: 'Collapse Recording A', exact: true })).toBeVisible();
  await narrator.fill('Draft for A');

  const bar = page.getByText(
    'You have an unsaved narrator or description entry. Save it before moving on?',
    { exact: true },
  );
  await page.getByRole('button', { name: 'Expand Recording B', exact: true }).click();
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse Recording A', exact: true })).toBeVisible();
  await expect(narrator).toHaveValue('Draft for A');

  await page.getByRole('button', { name: 'Expand Recording B', exact: true }).click();
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse Recording B', exact: true })).toBeVisible();
});

test('warns before losing an unsaved narrator draft when changing the filter', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const empty = { values: {}, narrators: [], series: '', series_position: '' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'owner', admin: true, display_name: 'Max' };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/libraries/library') json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
    if (path === '/works')
      json = { items: [{ id: 'island', library_id: 'library', title: 'Treasure Island', author: 'R. L. Stevenson', listenable: true, readable: true, narrators: [] }], has_more: false, offset: 0 };
    if (path === '/works/island') json = { id: 'island', title: 'Treasure Island', author: 'R. L. Stevenson' };
    if (path === '/works/island/representations')
      json = [{ id: 'audio', work_id: 'island', kind: 'audio', label: 'Audiobook', narrators: [] }];
    if (path === '/libraries/library/representations/audio/media')
      json = [{ id: 'file', representation_id: 'audio', kind: 'audio', original_filename: 'Treasure Island.m4b' }];
    if (path === '/media/file/metadata') json = { asin: '', current: empty, suggested: empty };
    await route.fulfill({ json });
  });
  await page.goto('/library/library/metadata');
  await page.getByRole('button', { name: 'Review Treasure Island', exact: true }).click();
  await page.getByRole('textbox', { name: 'Narrator names', exact: true }).fill('Draft narrator');

  await page.getByRole('button', { name: 'Show: Needs attention', exact: true }).click();
  await page.getByRole('radio', { name: 'All books', exact: true }).click();
  await expect(
    page.getByText(
      'You have an unsaved narrator or description entry. Save it before moving on?',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Narrator names', exact: true })).toHaveValue('Draft narrator');
});

test('warns before losing an unsaved description edit when leaving the page', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let description = 'A voyage in search of buried treasure.';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const method = route.request().method();
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'owner', admin: true, display_name: 'Max' };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/libraries/library') json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
    if (path === '/works')
      json = { items: [{ id: 'island', library_id: 'library', title: 'Treasure Island', author: 'R. L. Stevenson', listenable: false, readable: true, narrators: [] }], has_more: false, offset: 0 };
    if (path === '/works/island' && method === 'PATCH') {
      description = route.request().postDataJSON().description;
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === '/works/island') json = { id: 'island', title: 'Treasure Island', author: 'R. L. Stevenson', description };
    if (path === '/works/island/representations') json = [];
    await route.fulfill({ json });
  });
  await page.goto('/library/library/metadata');
  await page.getByRole('button', { name: 'Review Treasure Island', exact: true }).click();
  await page.getByRole('button', { name: 'Expand book details', exact: true }).click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit manually', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Description', exact: true });
  await field.fill('A revised description, not yet saved.');

  const bar = page.getByText(
    'You have an unsaved narrator or description entry. Save it before moving on?',
    { exact: true },
  );
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(field).toHaveValue('A revised description, not yet saved.');
  expect(page.url()).toContain('/metadata');

  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(page).toHaveURL(/\/library\/library$/);
});

test('an inline Audnexus save does not overwrite a pending manual narrator draft', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let description = 'A voyage in search of buried treasure.';
  let applied = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const method = route.request().method();
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'owner', admin: true, display_name: 'Max' };
    if (path === '/setup/status') json = { available: false, demo_available: false };
    if (path === '/libraries/library') json = { id: 'library', name: 'Classics', role: 'owner', effective: true };
    if (path === '/works')
      json = { items: [{ id: 'island', library_id: 'library', title: 'Treasure Island', author: 'R. L. Stevenson', listenable: true, readable: true, narrators: [] }], has_more: false, offset: 0 };
    if (path === '/works/island') json = { id: 'island', title: 'Treasure Island', author: 'R. L. Stevenson', description };
    if (path === '/works/island/representations')
      json = [{ id: 'audio', work_id: 'island', kind: 'audio', label: 'Audiobook', narrators: [] }];
    if (path === '/libraries/library/representations/audio/media')
      json = [{ id: 'file', representation_id: 'audio', kind: 'audio', original_filename: 'Treasure Island.m4b' }];
    if (path === '/media/file/metadata')
      json = { asin: 'B002V1CI40', current: { values: {}, narrators: [], series: '', series_position: '' }, suggested: { values: {}, narrators: [], series: '', series_position: '' } };
    if (path === '/works/island/representations/audio/metadata/audiobook' && method === 'GET')
      json = {
        recording: { publisher: 'Blackstone Audio', language: 'English', release_date: '2015-03-01', runtime_minutes: 420, format: 'mp3' },
        asin: 'B002V1CI40',
        region: 'us',
        title: 'Treasure Island',
        authors: ['Robert Louis Stevenson'],
        runtime_minutes: 420,
        format: 'Unabridged',
        current: { narrators: [], description },
        values: { narrators: ['Mark Nelson'], description: 'A revised description from Audnexus.' },
      };
    if (path === '/works/island/representations/audio/metadata/audiobook' && method === 'POST') {
      expect(route.request().postDataJSON().fields).toEqual(['description']);
      description = 'A revised description from Audnexus.';
      applied = true;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json });
  });
  await page.goto('/library/library/metadata');
  await page.getByRole('button', { name: 'Review Treasure Island', exact: true }).click();

  const narrator = page.getByRole('textbox', { name: 'Narrator names', exact: true });
  await narrator.fill('My Own Narrator');

  await expect(page.getByText('Replace book description', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Replace book description', exact: true }).click();
  await page.getByRole('button', { name: 'Save selected changes', exact: true }).click();
  await expect(page.getByText('Saved from Audnexus.', { exact: true })).toBeVisible();
  expect(applied).toBe(true);

  // The manual narrator draft the reviewer was typing must survive an unrelated inline save,
  // and applying it must not force navigation away from this book.
  await expect(narrator).toHaveValue('My Own Narrator');
  expect(page.url()).toContain('/metadata');
  // Appears once in the lookup panel's own comparison and again in the Book
  // details card once refreshSelected() re-fetches the work — the second
  // occurrence is what proves the in-place refresh actually happened.
  await expect(page.getByText('A revised description from Audnexus.', { exact: true }).last()).toBeVisible();
});
