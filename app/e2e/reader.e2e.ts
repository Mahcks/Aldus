import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

test('an administrator can read, listen, and configure KOReader safely', async ({ page }) => {
  await signInAsTestAdmin(page);

  await page.goto('/work/alice-gutenberg-11-work');
  await expect(
    page.getByRole('heading', { name: "Alice's Adventures in Wonderland" }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Start reading|Continue reading|Read instead/ }).click();

  const settings = page.getByRole('button', { name: 'Open reader settings' });
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Saved here')).toBeVisible({ timeout: 10_000 });

  await settings.click();
  await expect(page.getByText('Typography', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close reader settings' }).click();

  // An ordinary format change keeps playback paused.
  const readURL = page.url();
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 });

  await page.goto(readURL);
  await expect(page.getByRole('button', { name: 'Open table of contents' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  await page.getByRole('button', { name: 'CHAPTER I. Down the Rabbit-Hole' }).click();
  await expect(page.getByRole('button', { name: 'Listen from here' })).toBeVisible({
    timeout: 30_000,
  });

  // A synchronized handoff carries the user's intent to continue with narration.
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });

  await page.goto(readURL);
  await expect(page.getByRole('button', { name: 'Open table of contents' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  await page.getByRole('button', { name: 'CHAPTER I. Down the Rabbit-Hole' }).click();
  await expect(page.getByRole('button', { name: 'Listen from here' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Switch to listening' })).toBeEnabled();

  await page.route('**/works/alice-gutenberg-11-work/progress', async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByText(/Offline mode/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await page.unroute('**/works/alice-gutenberg-11-work/progress');

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByText(/KOReader needs your server's LAN or HTTPS address/)).toBeVisible();
  await page.getByRole('button', { name: 'Create reader credential' }).click();
  await expect(page.getByText(/Credential created\. Save this password now/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'KOReader setup guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(4);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByText(/Credential created\. Save this password now/).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
