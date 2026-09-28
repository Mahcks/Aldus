import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`file metadata review preserves choices and detects stale edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    let current = {
      values: {
        title: 'A book',
        author: 'An author',
        description: 'My description.',
        isbn: '',
        publisher: '',
        language: '',
        subjects: [],
        first_publish_year: 0,
        cover_url: '',
      },
      series: '',
      series_position: '',
      narrators: ['Old narrator'],
    };
    const suggested = {
      ...current,
      values: { ...current.values, description: 'A longer description from the file.' },
      series: 'A series',
      series_position: '2',
      narrators: ['Jane Doe', 'John Smith'],
    };
    let conflict = true;
    const requests: { fields: string[] }[] = [];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', admin: true, display_name: 'Owner' };
      if (path === '/setup/status') json = { available: false, demo_available: false };
      if (path === '/representations/recording')
        json = {
          id: 'recording',
          work_id: 'book',
          kind: 'audio',
          label: 'Audiobook',
          narrators: current.narrators,
        };
      if (path === '/works/book')
        json = { id: 'book', library_id: 'library', title: 'A book', author: 'An author' };
      if (path === '/libraries/library')
        json = { id: 'library', name: 'Books', role: 'owner', effective: true };
      if (path === '/libraries/library/representations/recording/media')
        json = [
          {
            id: 'file',
            representation_id: 'recording',
            kind: 'audio',
            original_filename: 'A book.m4b',
            sha256: 'a'.repeat(64),
            size_bytes: 5000,
            created_at: '2026-01-01T00:00:00Z',
          },
        ];
      if (path === '/media/file/metadata') json = { current, suggested, asin: '' };
      if (path.endsWith('/metadata/audiobook')) {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          expect(body.fields).toEqual(['description']);
          expect(body.asin).toBe('B08G9PRS1K');
          current = {
            ...current,
            values: { ...current.values, description: body.values.description },
          };
          await route.fulfill({ status: 204 });
          return;
        }
        json = {
          asin: 'B08G9PRS1K',
          region: 'us',
          title: 'A book',
          authors: ['An author'],
          runtime_minutes: 970,
          format: 'unabridged',
          recording: {
            publisher: 'Audio Press',
            language: 'english',
            release_date: '2021-05-04',
            runtime_minutes: 970,
            format: 'unabridged',
          },
          current: { narrators: current.narrators, description: current.values.description },
          values: {
            narrators: ['Another recording narrator'],
            description: 'A complete provider synopsis with enough detail to choose this book.',
          },
        };
      }
      if (path === '/media/file/metadata/apply') {
        requests.push(route.request().postDataJSON());
        if (conflict) {
          conflict = false;
          current = { ...current, narrators: ['Another editor'] };
          await route.fulfill({ status: 409, body: 'Selected details changed.' });
        } else {
          current = { ...current, narrators: suggested.narrators };
          await route.fulfill({ status: 204 });
        }
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto('/representation/recording');
    const edition = page.getByRole('textbox', { name: 'Edition name', exact: true });
    await edition.fill('My unsaved edition');
    await expect(
      page.getByRole('button', { name: 'Review details from file', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Find audiobook details', exact: true }),
    ).toBeDisabled();
    await expect(page.getByText('Save file settings before reviewing metadata.')).toBeVisible();
    await edition.fill('Audiobook');
    await page.getByRole('button', { name: 'Review details from file', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review details from this file', exact: true });
    await expect(
      dialog.getByText('A longer description from the file.', { exact: true }),
    ).toBeVisible();
    const apply = dialog.getByRole('button', { name: 'Apply selected changes', exact: true });
    await expect(apply).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Update narrators', exact: true }).click();
    await page.screenshot({
      path: `../artifacts/metadata-repair/${width}-review.png`,
      animations: 'disabled',
    });
    await apply.click();
    await expect(
      dialog.getByText(
        'These details changed since you opened the preview. Reload to compare again.',
      ),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload preview' }).click();
    await expect(dialog.getByText('Another editor', { exact: true })).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Update narrators', exact: true }).click();
    await apply.click();
    await expect(dialog).not.toBeVisible();
    expect(requests.map((request) => request.fields)).toEqual([['narrators'], ['narrators']]);
    expect(current.values.description).toBe('My description.');
    await page.getByRole('button', { name: 'Find audiobook details', exact: true }).click();
    const audiobook = page.getByRole('dialog', { name: 'Review audiobook details', exact: true });
    await audiobook.getByRole('textbox', { name: 'Audible ASIN', exact: true }).fill('B08G9PRS1K');
    await audiobook.getByRole('button', { name: 'Look up recording', exact: true }).click();
    await expect(
      audiobook.getByText('A complete provider synopsis with enough detail to choose this book.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `../artifacts/metadata-repair/${width}-audiobook.png`,
      animations: 'disabled',
    });
    await audiobook.getByRole('checkbox', { name: /description/i }).click();
    await audiobook.getByRole('button', { name: 'Apply selected changes', exact: true }).click();
    await expect(audiobook).not.toBeVisible();
    expect(current.narrators).toEqual(['Jane Doe', 'John Smith']);
  });
}
