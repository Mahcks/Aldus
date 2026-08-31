import { expect, test } from '@playwright/test';

const username = process.env.ALDUS_ECOSYSTEM_USERNAME || 'ecosystem-admin';
const password = process.env.ALDUS_ECOSYSTEM_PASSWORD || 'aldus-ecosystem-123';
const phase = process.env.ALDUS_ECOSYSTEM_PHASE;
const evidence = process.env.ALDUS_ECOSYSTEM_SCREENSHOT;
const server = process.env.ALDUS_ECOSYSTEM_SERVER;

test('web participates in the KOReader progress handoff', async ({ page }) => {
  test.skip(!phase, 'Run by the KOReader acceptance job.');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your library' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.goto('/work/alice-gutenberg-11-work');
  const openReader = phase === 'seed' ? 'Start reading' : /Continue reading|Read instead/;
  await page.getByRole('button', { name: openReader }).click();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible({ timeout: 30_000 });

  if (phase === 'verify') {
    await expect(page.getByText('Resumed from KOReader')).toBeVisible({ timeout: 15_000 });
  } else {
    expect(phase).toBe('seed');
  }

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Saved here')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Switch to reading' }).click();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(async (origin) => {
          const response = await fetch(`${origin}/api/v1/works/alice-gutenberg-11-work/progress`, {
            credentials: 'include',
          });
          if (!response.ok) return '';
          return (await response.json()).source_device || '';
        }, server),
      { timeout: 15_000 },
    )
    .toBe('web');
  if (evidence) await page.screenshot({ path: evidence, fullPage: true });
});
