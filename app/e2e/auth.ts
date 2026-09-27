import { expect, type Page } from '@playwright/test';

export const testServer = process.env.ALDUS_ECOSYSTEM_SERVER || 'http://127.0.0.1:18080';

/** Accept the previous test's ownership before exercising this reader. */
export async function continueReadingHere(page: Page, mode: 'read' | 'listen' = 'read') {
  const ready = page.getByRole('button', {
    name: mode === 'read' ? 'Open reader settings' : 'Set sleep timer',
    exact: true,
  });
  const takeover = page.getByRole('button', { name: 'Continue here', exact: true });
  await expect(ready.or(takeover)).toBeVisible({ timeout: 30_000 });
  if (await takeover.isVisible()) await takeover.click();
  await expect(ready).toBeEnabled({ timeout: 30_000 });
}

const credentials = {
  username: 'beta-admin',
  display_name: 'Beta Admin',
  password: 'beta-password-123',
  password_confirmation: 'beta-password-123',
};

export async function signInAsTestAdmin(page: Page) {
  const setup = await page.request.post(`${testServer}/api/v1/setup`, { data: credentials });
  if (!setup.ok() && setup.status() !== 404) {
    throw new Error(`Test administrator setup failed with status ${setup.status()}.`);
  }
  if (setup.status() === 404) {
    const login = await page.request.post(`${testServer}/api/v1/auth/login`, {
      data: { username: credentials.username, password: credentials.password },
    });
    expect(login.ok()).toBe(true);
  }

  await page.goto('/libraries');
  await expect(page).toHaveURL(/\/libraries$/);
}
