import { expect, test, type Page } from '@playwright/test';

async function settleDialog(page: Page, name: string) {
  await expect
    .poll(() =>
      page.getByRole('dialog', { name }).evaluate((node) => {
        for (let current: Element | null = node; current; current = current.parentElement) {
          if (Number(getComputedStyle(current).opacity) < 1) return false;
        }
        return true;
      }),
    )
    .toBe(true);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1024, 1440]) {
    test(`audiobook artwork and readable fallback at ${width}px ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const title = 'Sunrise on the Reaping';
      const art = '/api/media/audio-file/cover';
      let embedded = false;
      let otherCover = false;
      let selectedBookCover = false;
      let selectionFailure = false;
      let uploads = 0;
      let galleryFailure = false;
      let workFailure = false;
      let design = 'classic';
      let holdSearch = false;
      let releaseSearch: (() => void) | undefined;
      let holdGallery = false;
      let releaseGallery: (() => void) | undefined;
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="teal"/></svg>';
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
          .replace('/api/v1', '')
          .replace(/^\/api/, '');
        if (path === '/media/audio-file/cover' || path === '/media/ebook-file/cover') {
          await route.fulfill(
            embedded || path === '/media/ebook-file/cover'
              ? { contentType: 'image/svg+xml', body: svg }
              : { status: 404 },
          );
          return;
        }
        if (path === '/works/book/cover/settings' && route.request().method() === 'PATCH') {
          design = route.request().postDataJSON().style;
          workFailure = true;
          await route.fulfill({ status: 204 });
          return;
        }
        if (path === '/works/book' && workFailure) {
          workFailure = false;
          await route.fulfill({ status: 503, body: 'Could not reload the work.' });
          return;
        }
        if (
          path === '/works/book/covers' &&
          holdGallery &&
          new URL(route.request().url()).searchParams.get('format') === 'audiobook'
        ) {
          await new Promise<void>((resolve) => {
            releaseGallery = resolve;
          });
        }
        if (path === '/works/book/covers' && galleryFailure) {
          await route.fulfill({ status: 503, body: 'Please try loading images again.' });
          return;
        }
        if (path === '/works/book/cover/audiobook' && route.request().method() === 'POST') {
          uploads += 1;
          selectedBookCover = true;
          await route.fulfill({ status: 204 });
          return;
        }
        if (path === '/works/book/cover/audiobook' && route.request().method() === 'PUT') {
          if (selectionFailure) {
            selectionFailure = false;
            await route.fulfill({ status: 503, body: 'Cover could not be saved.' });
            return;
          }
          expect(route.request().postDataJSON()).toEqual({
            source: 'open_library',
            source_id: '14847912',
          });
          selectedBookCover = true;
          await route.fulfill({ status: 204 });
          return;
        }
        let json: unknown = [];
        if (path === '/works/book/covers/search' && holdSearch) {
          await new Promise<void>((resolve) => {
            releaseSearch = resolve;
          });
          await route.fulfill({
            json: [
              {
                source: 'open_library',
                source_id: 'stale',
                title: 'Stale audiobook result',
                format: 'audiobook',
                image_url: art,
              },
            ],
          });
          return;
        }
        if (path === '/works/book/covers/search') {
          const format = new URL(route.request().url()).searchParams.get('format');
          json =
            format === 'ebook'
              ? [
                  {
                    source: 'open_library',
                    source_id: '14847912',
                    title,
                    author: 'Suzanne Collins',
                    image_url: '/api/media/ebook-file/cover',
                    format: 'ebook',
                  },
                ]
              : [];
        }
        if (path === '/auth/me') json = { id: 'owner', username: 'max', admin: true };
        if (path === '/setup/status') json = { available: false };
        if (path === '/libraries/family') json = { id: 'family', name: 'Family', role: 'owner' };
        if (path === '/works/book')
          json = {
            id: 'book',
            library_id: 'family',
            title,
            author: 'Suzanne Collins',
            cover_url: art,
            audiobook_cover_url: selectedBookCover ? '/api/media/ebook-file/cover' : art,
            ebook_cover_url: otherCover ? '/api/media/ebook-file/cover' : '',
            genre_tags: [],
            subject_values: [],
            cover_fit: 'cover',
            cover_focal_x: 50,
            cover_focal_y: 50,
            generated_cover_style: design,
            generated_cover_tone: 4,
            generated_cover_layout: 'center',
          };
        if (path === '/works/book/representations')
          json = [{ id: 'audio', work_id: 'book', kind: 'audio', label: 'Audiobook' }];
        if (path === '/libraries/family/representations/audio/media')
          json = [
            {
              id: 'audio-file',
              kind: 'audio',
              representation_id: 'audio',
              original_filename: 'sunrise.m4b',
            },
          ];
        if (path === '/works/book/covers')
          json =
            embedded && new URL(route.request().url()).searchParams.get('format') === 'audiobook'
              ? [
                  {
                    id: 'embedded-audio',
                    label: 'Audiobook',
                    original_filename: 'sunrise.m4b',
                    source: 'embedded',
                    source_id: 'audio-file',
                    image_url: art,
                    format: 'audiobook',
                  },
                ]
              : [];
        await route.fulfill({ json });
      });
      await page.goto('/work/book');
      const cover = page.getByLabel(`Cover for ${title}`, { exact: true });
      const text = cover.getByText(title, { exact: true });
      await expect(text).toBeVisible();
      await expect
        .poll(() => text.evaluate((node) => node.scrollHeight <= node.clientHeight + 1))
        .toBe(true);
      await page.screenshot({
        path: `../artifacts/audiobook-cover/${width}-${theme}-fallback.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.goto('/work/book/manage?tab=artwork');
      await expect(page.getByText('Automatic fallback', { exact: true })).toBeVisible();
      await expect(cover.getByText(title, { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          cover
            .getByText(title, { exact: true })
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
        )
        .toBe(true);
      await page.screenshot({
        path: `../artifacts/audiobook-cover/${width}-${theme}-studio.png`,
        fullPage: true,
        animations: 'disabled',
      });
      otherCover = true;
      await page.goto('/work/book');
      await expect
        .poll(() =>
          cover
            .locator('img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      await expect(cover.locator('img')).toHaveAttribute('src', /ebook-file/);
      embedded = true;
      await page.goto('/work/book/manage?tab=artwork');
      await expect(
        page
          .getByRole('radiogroup', { name: 'Cover for' })
          .getByRole('radio', { name: 'Audiobook', exact: true }),
      ).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('From your file', { exact: true })).toBeVisible();
      await expect(cover.getByText(title, { exact: true })).toHaveCount(0);
      await expect
        .poll(() =>
          cover
            .last()
            .locator('img')
            .evaluate((image) => {
              for (let node: Element | null = image; node; node = node.parentElement) {
                const background = getComputedStyle(node).backgroundColor;
                if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent')
                  return background;
              }
              return '';
            }),
        )
        .toBe(theme === 'dark' ? 'rgb(23, 20, 16)' : 'rgb(250, 247, 242)');

      await page.goto('/work/book');
      await expect(cover.locator('img')).toBeVisible();
      await expect
        .poll(() =>
          cover
            .locator('img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      await page.goto('/work/book/manage?tab=artwork');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText(/No audiobook covers found/)).toBeVisible();
      await page.getByRole('button', { name: 'Search book covers instead', exact: true }).click();
      await expect(page.getByText(/Book editions · You can use any/)).toBeVisible();
      const candidate = page.getByRole('button', {
        name: `Preview cover: ${title}, Open Library`,
        exact: true,
      });
      await expect(candidate).toBeVisible();
      await candidate.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `../artifacts/audiobook-cover/${width}-${theme}-book-search.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await candidate.click();
      await expect(page.getByRole('dialog', { name: 'Preview cover' })).toBeVisible();
      expect(selectedBookCover).toBe(false);
      await settleDialog(page, 'Preview cover');
      await page.screenshot({
        path: `../artifacts/audiobook-cover/${width}-${theme}-preview.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(candidate).toBeFocused();
      await candidate.press('Enter');
      selectionFailure = true;
      await page.getByRole('button', { name: 'Use this cover', exact: true }).click();
      await expect(
        page
          .getByRole('dialog', { name: 'Preview cover' })
          .getByText('Cover could not be saved.', { exact: true }),
      ).toBeVisible();
      expect(selectedBookCover).toBe(false);
      await page.getByRole('button', { name: 'Use this cover', exact: true }).click();
      await expect.poll(() => selectedBookCover).toBe(true);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        page
          .getByRole('radiogroup', { name: 'Cover for' })
          .getByRole('radio', { name: 'Audiobook', exact: true }),
      ).toHaveAttribute('aria-checked', 'true');
      galleryFailure = true;
      await page.goto('/work/book/manage?tab=artwork');
      await page.getByRole('tab', { name: 'Your images', exact: true }).click();
      await expect(page.getByText('Couldn’t load your images', { exact: true })).toBeVisible();
      await expect(page.getByText('Automatic fallback', { exact: true })).toHaveCount(0);
      galleryFailure = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(
        page.getByRole('button', { name: /Preview cover: From your file/ }),
      ).toBeVisible();
      await page.screenshot({
        path: `../artifacts/audiobook-cover/${width}-${theme}-saved.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Cover options', exact: true }).click();
      await page.getByRole('radio', { name: 'Minimal', exact: true }).click();
      await page.getByRole('button', { name: 'Use automatic artwork', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Minimal', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await settleDialog(page, 'Cover options');
      await page.screenshot({
        path: `../artifacts/audiobook-cover/${width}-${theme}-options.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Classic', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await page.getByRole('radio', { name: 'Minimal', exact: true }).click();
      await page.getByRole('button', { name: 'Save design', exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: 'Cover options' }).getByText(/Your change was saved/),
      ).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Minimal', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await page
        .getByRole('dialog', { name: 'Cover options' })
        .getByRole('button', { name: 'Refresh cover' })
        .click();
      await expect(page.getByText('No design changes', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.goto('/work/book');
      await expect(cover.locator('img')).toHaveAttribute('src', /ebook-file/);
      await page.goto('/work/book/manage?tab=artwork');
      holdSearch = true;
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect.poll(() => Boolean(releaseSearch)).toBe(true);
      await page
        .getByRole('radiogroup', { name: 'Cover for' })
        .getByRole('radio', { name: 'Ebook', exact: true })
        .click();
      const lateResponse = page.waitForResponse((response) =>
        response.url().includes('/covers/search'),
      );
      releaseSearch!();
      await lateResponse;
      await expect(page.getByText('Find the cover you love', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Stale audiobook result/ })).toHaveCount(0);
      holdGallery = true;
      await page
        .getByRole('radiogroup', { name: 'Cover for' })
        .getByRole('radio', { name: 'Audiobook', exact: true })
        .click();
      await expect.poll(() => Boolean(releaseGallery)).toBe(true);
      await expect(page.getByText('Checking artwork…', { exact: true })).toBeVisible();
      await page
        .getByRole('radiogroup', { name: 'Cover for' })
        .getByRole('radio', { name: 'Ebook', exact: true })
        .click();
      await page.getByRole('tab', { name: 'Your images', exact: true }).click();
      await expect(page.getByText('No saved images yet', { exact: true })).toBeVisible();
      const lateGallery = page.waitForResponse((response) =>
        response.url().includes('/covers?format=audiobook'),
      );
      releaseGallery!();
      await lateGallery;
      await expect(page.getByText('No saved images yet', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Preview cover: From your file/ })).toHaveCount(
        0,
      );
      if (width === 390 && theme === 'light') {
        holdGallery = false;
        await page.goto('/work/book/manage?tab=artwork');
        const upload = page.getByRole('button', { name: 'Upload image', exact: true });
        const target = page
          .getByRole('radiogroup', { name: 'Cover for' })
          .getByRole('radio', { name: 'Audiobook', exact: true });
        const canceledPicker = page.waitForEvent('filechooser');
        await upload.click();
        await canceledPicker;
        await expect(target).toBeDisabled();
        await page.locator('input[type=file]').last().dispatchEvent('cancel');
        await expect(upload).toBeEnabled();
        await expect(target).toBeEnabled();
        expect(uploads).toBe(0);
        const image = {
          name: 'cover.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
        };
        await page.evaluate(() => {
          const append = document.body.appendChild.bind(document.body);
          document.body.appendChild = (node) => {
            if (node instanceof HTMLInputElement && node.type === 'file')
              throw new Error('Picker unavailable.');
            return append(node);
          };
        });
        await upload.click();
        await expect(page.getByText('Something went wrong.', { exact: true })).toBeVisible();
        await expect(upload).toBeEnabled();
        expect(uploads).toBe(0);
        await page.reload();
        const picker = page.waitForEvent('filechooser');
        await upload.click();
        await (await picker).setFiles(image);
        await expect(
          page.getByText('Image uploaded and set as the cover.', { exact: true }),
        ).toBeVisible();
        expect(uploads).toBe(1);
        await expect(target).toHaveAttribute('aria-checked', 'true');
      }
      expect(errors).toEqual([]);
    });
  }
}
