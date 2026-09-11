import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

const artwork =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="sienna"/></svg>';

for (const width of [390, 1024, 1440]) {
  test(`book details shows one cover with a missing-cover fallback at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAsTestAdmin(page);
    await page.route('**/works/alice-gutenberg-11-work', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: { ...(await response.json()), cover_url: '/api/covers/test-library' },
      });
    });
    await page.route('**/api/covers/test-library', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: artwork }),
    );
    let missingArtwork = false;
    await page.route('**/api/media/*/cover', (route) =>
      missingArtwork
        ? route.fulfill({ status: 404 })
        : route.fulfill({ contentType: 'image/svg+xml', body: artwork }),
    );
    // The book's own page shows one cover, full stop — the ebook/audiobook
    // split belongs to Manage → Artwork, not to a "here are our two image
    // fields" display on the book's page.
    await page.goto('/work/alice-gutenberg-11-work');
    const images = page.locator('img[src*="/api/media/"][src$="/cover"]');
    await expect(images).toHaveCount(1);
    await expect(images.first()).toHaveCSS('object-fit', 'cover');
    await expect(page.getByText('Ebook', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Audiobook', { exact: true })).toHaveCount(0);
    await expect
      .poll(() =>
        images.evaluateAll((nodes) =>
          nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0),
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: testInfo.outputPath('edition-details.png'), fullPage: true });
    // Listening still works from the book's page — the player's own cover
    // logic is exact-progress-adjacent code, out of scope here.
    await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    missingArtwork = true;
    await page.goto('/work/alice-gutenberg-11-work');
    const fallback = page.locator('img[src$="/api/covers/test-library"]');
    await expect(fallback).toHaveCount(1);
    await expect
      .poll(() =>
        fallback.evaluateAll((nodes) =>
          nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0),
        ),
      )
      .toBe(true);
  });
}

for (const width of [390, 1024, 1440]) {
  test(`cover studio saves audiobook artwork independently at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAsTestAdmin(page);
    const { testServer } = await import('./auth');
    const workURL = `${testServer}/api/v1/works/alice-gutenberg-11-work`;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    expect(
      (
        await page.request.post(`${workURL}/cover/audiobook`, {
          multipart: { file: { name: 'audio.png', mimeType: 'image/png', buffer: png } },
        })
      ).ok(),
    ).toBe(true);
    const saved = await (await page.request.get(workURL)).json();
    const uploaded = saved.audiobook_cover_url;
    expect(uploaded).toContain('/api/covers/');
    await page.goto('/work/alice-gutenberg-11-work/manage?tab=artwork');
    await expect(page.getByRole('radio', { name: 'Library cover', exact: true })).toHaveCount(0);
    const ebookPreview = page.locator('img[src*="/api/media/"][src$="/cover"]').nth(1);
    await expect(ebookPreview).toBeVisible();
    await expect(ebookPreview).toHaveCSS('object-fit', 'cover');
    await ebookPreview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('ebook-poster-fill.png') });
    await page.getByRole('radio', { name: 'Audiobook cover', exact: true }).click();
    const preview = page.locator(`img[src$="${uploaded}"]`).first();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('object-fit', 'cover');
    const bounds = await preview.boundingBox();
    expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(2);
    await page.screenshot({
      path: testInfo.outputPath('audiobook-cover-studio.png'),
      fullPage: true,
    });
    await page.route('**/covers/search?**', async (route) => {
      expect(new URL(route.request().url()).searchParams.get('format')).toBe('audiobook');
      await route.fulfill({
        json: [
          {
            source: 'open_library',
            source_id: '123',
            image_url: '/audio-search.png',
            title: 'Audio edition',
            format: 'audiobook',
          },
          {
            source: 'open_library',
            source_id: '456',
            image_url: '/ebook-search.png',
            title: 'Wrong ebook edition',
            format: 'ebook',
          },
        ],
      });
    });
    await page.route('**/audio-search.png', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: artwork }),
    );
    await page.getByRole('button', { name: 'Search audiobook covers', exact: true }).click();
    await expect(page.getByText('Audio edition', { exact: true })).toBeVisible();
    await expect(page.getByText('Wrong ebook edition', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Use automatic artwork', exact: true }).click();
    await expect(
      page.getByText('Automatic format artwork restored.', { exact: true }),
    ).toBeVisible();
    const reset = await (await page.request.get(workURL)).json();
    expect(reset.cover_url).toBe(saved.cover_url);
    expect(reset.ebook_cover_url).toBe(saved.ebook_cover_url);
    expect(reset.audiobook_cover_url).not.toBe(uploaded);
    await page.getByRole('radio', { name: 'Ebook cover', exact: true }).click();
    await expect(page.getByText('Audio edition', { exact: true })).toHaveCount(0);
    const uploadedCard = page
      .locator('div')
      .filter({ has: page.locator(`img[src$="${uploaded}"]`) })
      .filter({ has: page.getByRole('button', { name: 'Delete upload', exact: true }) })
      .last();
    await uploadedCard.getByRole('button', { name: 'Use cover', exact: true }).click();
    await expect(page.getByText('Artwork selected.', { exact: true })).toBeVisible();
    const selected = await (await page.request.get(workURL)).json();
    expect(selected.ebook_cover_url).toBe(uploaded);
    expect(selected.audiobook_cover_url).toBe(reset.audiobook_cover_url);
    expect(selected.cover_url).toBe(uploaded);
    await page.request.delete(`${workURL}/cover/ebook`);
    await page.request.delete(`${workURL}/covers/${uploaded.split('/').at(-1)}`);
  });
}
