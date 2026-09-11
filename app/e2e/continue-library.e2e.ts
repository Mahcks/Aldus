import { expect, test } from '@playwright/test';
import { signInAsTestAdmin, testServer } from './auth';

for (const width of [390, 1024, 1440]) {
  test(`Continue exposes a vertical in-progress library at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAsTestAdmin(page);
    const catalog = await (await page.request.get(`${testServer}/api/v1/works`)).json();
    const titles = Array.from({ length: 30 }, (_, index) => ({
      ...catalog.items[0],
      id: `started-${index + 1}`,
      title: `Started book ${index + 1}`,
      in_progress: true,
      completion_percent: 20 + index,
      last_mode: index === 1 || index % 2 === 0 ? 'listen' : 'read',
      readable: true,
      listenable: index !== 1,
      cover_url: '/api/covers/continue-fallback',
      audiobook_cover_url: '/api/media/audio-cover/cover',
    }));
    const requests: URL[] = [];
    await page.route('**/api/v1/works?*', async (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 24);
      const items = url.searchParams.get('availability') === 'in_progress' ? titles : [];
      await route.fulfill({
        json: {
          items: items.slice(offset, offset + limit),
          offset,
          has_more: offset + limit < items.length,
        },
      });
    });
    await page.route('**/api/media/audio-cover/cover', route => route.fulfill({ status: 404 }));
    await page.route('**/api/covers/continue-fallback', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="sienna"/></svg>' }));
    await page.goto('/home');
    await expect(
      page.getByRole('button', { name: 'Continue listening', exact: true }),
    ).toBeVisible();
    const second = page.getByRole('button', { name: /^Started book 2 by / });
    await expect(second).toBeVisible();
    const fourth = page.getByRole('button', { name: /^Started book 4 by / });
    await expect(fourth).toBeVisible();
    const featuredCover = page.getByLabel('Cover for Started book 1', { exact: true });
    const coverBounds = await featuredCover.boundingBox();
    expect(Math.abs(coverBounds!.width - coverBounds!.height)).toBeLessThan(2);
    await expect(page.getByText(/\d+ books? in progress/)).toHaveCount(0);
    const audiobookCover = page.getByLabel('Cover for Started book 3', { exact: true });
    await expect(audiobookCover.locator('img[src$="/api/covers/continue-fallback"]')).toHaveCount(1);
    const audiobookBounds = await audiobookCover.boundingBox();
    expect(Math.abs(audiobookBounds!.width - audiobookBounds!.height)).toBeLessThan(2);
    await second.click();
    await expect(page).toHaveURL(/consume\/started-2\?mode=read/);
    await page.goBack();
    await expect(page.getByRole('button', { name: 'See all', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('continue-home.png'), fullPage: true });
    await page.getByRole('button', { name: 'See all', exact: true }).click();
    await expect(page).toHaveURL(/books\?status=in_progress/);
    await expect(page.getByRole('link', { name: /^Started book 2 by / })).toBeVisible();
    expect(
      requests.some(
        (url) =>
          url.searchParams.get('availability') === 'in_progress' &&
          url.searchParams.get('sort') === 'progress' &&
          url.searchParams.get('limit') === '24' &&
          !url.searchParams.has('status'),
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('in-progress.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    const list = page.getByRole('main');
    await expect(async () => {
      await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      expect(requests.some((url) => url.searchParams.get('offset') === '24')).toBe(true);
    }).toPass({ timeout: 10000 });
    await expect(async () => {
      await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(page.getByRole('link', { name: /^Started book 30 by / })).toBeInViewport();
    }).toPass({ timeout: 10000 });
    await list.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole('link', { name: /^Started book 2 by / }).click();
    await expect(page).toHaveURL(/consume\/started-2\?mode=read/);
  });
}
