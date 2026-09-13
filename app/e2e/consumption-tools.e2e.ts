import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

test('reader search and sleep timer work through the extracted hooks', async ({ page }) => {
  await signInAsTestAdmin(page);
  await page.goto('/consume/alice-gutenberg-11-work?mode=read');
  const searchButton = page.getByRole('button', { name: 'Search inside book' });
  await expect(searchButton).toBeVisible({ timeout: 30_000 });
  await searchButton.click();

  const searchDialog = page.getByRole('dialog', { name: 'Search this book' });
  const query = searchDialog.getByRole('textbox', { name: 'Words or phrase' });
  await query.fill('aldus-no-matching-passage-9247');
  await searchDialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(searchDialog.getByText('No matches found.')).toBeVisible();

  await query.fill('Rabbit');
  await expect(searchDialog.getByText('No matches found.')).toHaveCount(0);
  await searchDialog.getByRole('button', { name: 'Search', exact: true }).click();
  const result = searchDialog.getByRole('button', { name: /rabbit/i }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(searchDialog).toHaveCount(0);

  await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
  const timerButton = page.getByRole('button', { name: 'Set sleep timer', exact: true });
  await expect(timerButton).toBeEnabled({ timeout: 30_000 });
  await timerButton.click();
  const timerDialog = page.getByRole('dialog', { name: 'Sleep timer', exact: true });
  await timerDialog.getByRole('radio', { name: '15 minutes', exact: true }).click();
  await expect(timerDialog).toHaveCount(0);
  await expect(page.getByText(/Sleep timer ·/)).toBeVisible();

  await page.getByRole('button', { name: /Sleep timer, .* remaining/ }).click();
  await timerDialog.getByRole('radio', { name: 'Off', exact: true }).click();
  await expect(page.getByText(/Sleep timer ·/)).toHaveCount(0);
  await expect(timerButton).toBeEnabled();
});

test('reading settings persist defaults separately from an edition override', async ({ page }) => {
  await signInAsTestAdmin(page);
  await page.goto('/consume/alice-gutenberg-11-work?mode=read');
  const settings = page.getByRole('button', { name: 'Open reader settings' });
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await settings.click();

  const allBooks = page.getByRole('radio', { name: 'All books', exact: true });
  await allBooks.click();
  await expect(allBooks).toBeChecked();
  const saveDefault = page.waitForResponse(
    (response) =>
      response.url().endsWith('/reader-preferences') && response.request().method() === 'PUT',
  );
  await page.getByRole('radio', { name: 'Sans', exact: true }).click();
  const defaults = await saveDefault;
  expect(defaults.ok()).toBe(true);
  expect((await defaults.json()).font_family).toBe('sans');

  await page.getByRole('radio', { name: 'This book', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'This book', exact: true })).toBeChecked();
  const saveEdition = page.waitForResponse(
    (response) =>
      /\/representations\/[^/]+\/state$/.test(response.url()) &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('radio', { name: 'Serif', exact: true }).click();
  const edition = await saveEdition;
  expect(edition.ok()).toBe(true);
  expect(await edition.json()).toMatchObject({
    font_family: 'serif',
    reader_preferences_override: true,
  });
  expect((await (await page.request.get(defaults.url())).json()).font_family).toBe('sans');

  await page.reload();
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await settings.click();
  await expect(page.getByRole('radio', { name: 'Serif', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'This book', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'All books', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Sans', exact: true })).toBeChecked();
});
