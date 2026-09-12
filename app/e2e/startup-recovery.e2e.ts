import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`startup timeout and retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let unavailable = true;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/me')) {
        if (unavailable) return; // Leave the request pending until the app's deadline.
        await route.fulfill({ status: 401, body: 'unauthorized' });
        return;
      }
      await route.fulfill({ json: { available: false, demo_available: false } });
    });
    await page.goto('/');
    await expect(page.getByTestId('loading-home')).toBeVisible();
    await expect(page.getByTestId('loading-home')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Couldn’t open your library', { exact: true })).toBeVisible({
      timeout: 22_000,
    });
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    await page.screenshot({ path: `../artifacts/startup-recovery/${width}.png` });
    unavailable = false;
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to your library' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeVisible();
  });
}
