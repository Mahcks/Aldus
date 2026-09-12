import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

const destinations = [
  { path: '/home', layout: 'home-feed' },
  { path: '/books', layout: 'library-grid' },
  { path: '/work/alice-gutenberg-11-work', layout: 'details' },
  { path: '/consume/alice-gutenberg-11-work?mode=listen', layout: 'player' },
];

for (const width of [390, 1024, 1440]) {
  for (const { path, layout } of destinations) {
    test(`${layout} loading at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAsTestAdmin(page);

      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.includes('/auth/') || pathname.includes('/setup')) {
          await route.continue();
          return;
        }
        await pending;
        await route.continue();
      });

      try {
        await page.goto(path);
        const skeleton = page.getByTestId(`loading-${layout}`);
        await expect(skeleton).toBeVisible();
        await expect(skeleton).toHaveAttribute('aria-busy', 'true');
        await expect(skeleton.getByRole('button')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await page.screenshot({ path: testInfo.outputPath('loading.png') });
      } finally {
        release();
      }
      await expect(page.getByTestId(`loading-${layout}`)).toHaveCount(0, { timeout: 20_000 });
    });
  }
}
