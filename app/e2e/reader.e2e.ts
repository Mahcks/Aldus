import { expect, test } from '@playwright/test';

test('a new administrator can read, listen, and configure KOReader safely', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create the first administrator' })).toBeVisible();

  await page.getByLabel('Username').fill('beta-admin');
  await page.getByLabel('Display name').fill('Beta Admin');
  await page.getByLabel('Password (12 characters minimum)').fill('beta-password-123');
  await page.getByLabel('Confirm password').fill('beta-password-123');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page).toHaveURL(/\/libraries$/);

  await page.goto('/work/alice-gutenberg-11-work');
  await expect(
    page.getByRole('heading', { name: "Alice's Adventures in Wonderland" }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start reading' }).click();

  const settings = page.getByRole('button', { name: 'Open reader settings' });
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Saved here')).toBeVisible({ timeout: 10_000 });

  await settings.click();
  await expect(page.getByText('Typography', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close reader settings' }).click();

  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Switch to reading' }).click();
  await expect(page.getByRole('button', { name: 'Switch to listening' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();

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
