import { expect, type Page } from '@playwright/test';

export const testServer = process.env.ALDUS_ECOSYSTEM_SERVER || 'http://127.0.0.1:18080';

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
