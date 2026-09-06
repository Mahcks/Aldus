import { expect, test } from '@playwright/test';
import type { ApplyMetadataRequest, MetadataValues } from '../src/generated/api';

for (const width of [390, 1024, 1440]) {
  test(`metadata review preserves selected fields and handles conflict at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    let current: MetadataValues = {
      title: 'Alice',
      author: 'Lewis Carroll',
      description: 'A manual description.',
      isbn: '',
      publisher: 'Old press',
      language: 'eng',
      first_publish_year: 1865,
      subjects: ['Fantasy'],
      cover_url: '',
    };
    const suggested: MetadataValues = {
      ...current,
      title: 'Alicia',
      description: '',
      publisher: 'Editorial Española',
      language: 'spa',
      isbn: '9780000000002',
    };
    let conflict = true;
    const applies: ApplyMetadataRequest[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', admin: true, display_name: 'Owner' };
      if (path === '/setup/status') json = { available: false, demo_available: false };
      if (path === '/libraries/library')
        json = { id: 'library', name: 'Books', role: 'owner', effective: true };
      if (path === '/works/book')
        json = {
          ...current,
          id: 'book',
          library_id: 'library',
          subject_values: current.subjects,
          genre_tags: [],
          cover_fit: 'cover',
          cover_focal_x: 50,
          cover_focal_y: 50,
          generated_cover_style: 'classic',
          generated_cover_tone: 0,
          generated_cover_layout: 'center',
        };
      if (path.endsWith('/metadata/candidates'))
        json = { current, candidates: [{ work_id: 'OL1W', edition_id: '', values: suggested }] };
      if (path.endsWith('/metadata/editions'))
        json = {
          current,
          candidates: [{ work_id: 'OL1W', edition_id: 'OL2M', values: suggested }],
        };
      if (path.endsWith('/metadata/apply')) {
        const body = route.request().postDataJSON() as ApplyMetadataRequest;
        applies.push(body);
        if (conflict) {
          conflict = false;
          current = { ...current, publisher: 'Another editor’s press' };
          await route.fulfill({
            status: 409,
            body: 'Selected details changed. Reload the preview before applying.',
          });
          return;
        }
        current = { ...current, language: body.values.language };
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto('/work/book/manage');
    const open = page.getByRole('button', { name: 'Find book details', exact: true });
    await expect(open).toBeEnabled();
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/metadata-review/${width}-manage.png`,
    });
    const bounds = await open.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);

    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved edit');
    await expect(open).toBeDisabled();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Alice');
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Review book details', exact: true });
    await dialog.getByRole('button', { name: 'Find matches', exact: true }).click();
    await dialog.getByRole('button', { name: 'View editions', exact: true }).click();
    await dialog.getByRole('button', { name: 'Review this edition', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Apply 0 selected changes', exact: true }),
    ).toBeDisabled();
    expect(applies).toHaveLength(0);
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/metadata-review/${width}-review.png`,
    });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await dialog.getByRole('checkbox', { name: 'Replace language', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply 1 selected change', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Reload preview', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload preview', exact: true }).click();
    await dialog.getByRole('button', { name: 'Review this edition', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Apply 0 selected changes', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Replace language', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply 1 selected change', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(applies[1].fields).toEqual(['language']);
    expect(applies[1].expected.publisher).toBe('Another editor’s press');
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Alice');
    await expect(page.getByRole('textbox', { name: 'Language', exact: true })).toHaveValue('spa');
    await open.click();
    await page.route('**/metadata/candidates?*', (route) =>
      route.fulfill({ status: 404, body: 'not found' }),
    );
    await dialog.getByRole('button', { name: 'Find matches', exact: true }).click();
    await expect(dialog.getByText(/Metadata review is unavailable on this server/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(applies).toHaveLength(2);
    expect(errors).toEqual([]);
  });
}
