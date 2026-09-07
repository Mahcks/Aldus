import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`public entry and reader connections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let mode = 'setup';
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/works') json = { items: [], has_more: false };
      if (path === '/auth/me') {
        if (mode === 'setup' || mode === 'demo') {
          await route.fulfill({ status: 401, body: 'Sign in required' });
          return;
        }
        json = {
          id: 'reader',
          username: 'sam',
          display_name: 'Sam',
          admin: false,
          must_change_credentials: mode === 'claim',
        };
      }
      if (path === '/setup/status')
        json = { available: mode === 'setup', demo_available: mode === 'demo' };
      if (path === '/setup' && route.request().method() === 'POST') {
        await route.fulfill({ status: 400, body: 'Try another username.' });
        return;
      }
      if (path === '/me/reader-credentials' && route.request().method() === 'POST')
        json = { id: 'kobo', label: 'My KOReader', secret: 'test-only-reader-secret' };
      await route.fulfill({ json });
    });
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Welcome to your library' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('sam');
    await page
      .getByLabel('Password (12 characters minimum)', { exact: true })
      .fill('test-password-123');
    await page.getByLabel('Confirm password', { exact: true }).fill('different');
    await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create administrator' })).toBeDisabled();
    await page.getByLabel('Confirm password', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: 'Create administrator' }).click();
    await expect(page.getByText('Try another username.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create administrator' })).toBeEnabled();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-setup.png` });
    mode = 'claim';
    await page.goto('/claim');
    await expect(page.getByRole('heading', { name: 'Make this account yours' })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-claim.png` });
    mode = 'demo';
    await page.goto('/demo');
    await expect(page.getByRole('button', { name: 'Explore demo', exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await page
              .getByText('Pride and Prejudice', { exact: true })
              .locator('..')
              .locator('..')
              .boundingBox()
          )?.y ?? 0,
      )
      .toBeGreaterThan(64);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-demo.png` });
    mode = 'account';
    await page.goto('/account');
    await expect(page.getByRole('button', { name: 'Create reader credential' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Manage reader connections', exact: true }).click();
    await page.getByRole('button', { name: 'Create reader credential' }).click();
    await expect(page.getByText('test-only-reader-secret', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 1000 });
    await expect(page.getByText('test-only-reader-secret', { exact: true })).toBeVisible();
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'I saved it', exact: true }).click();
    await page.getByRole('button', { name: 'Edit name', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit profile' });
    await expect(edit.getByRole('button', { name: 'Save name', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        edit.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-edit-profile.png` });
    await edit.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    const password = page.getByRole('dialog', { name: 'Change password', exact: true });
    await expect(
      password.getByRole('button', { name: 'Change password', exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        password.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-change-password.png` });
  });
}
