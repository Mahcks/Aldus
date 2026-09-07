import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

test('reading status exposes checked state and supports the Space key', async ({ page }) => {
  await signInAsTestAdmin(page);
  await page.goto('/work/alice-gutenberg-11-work?action=status');
  const dialog = page.getByRole('dialog', { name: 'Reading status', exact: true });
  const reading = dialog.getByRole('radio', { name: 'Reading', exact: true });
  await expect(reading).toHaveAttribute('aria-checked', /true|false/);
  await reading.focus();
  await page.keyboard.press('Space');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(reading).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio', { name: 'Finished', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});
