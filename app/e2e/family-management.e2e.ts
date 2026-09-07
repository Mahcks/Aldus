import { expect, test } from '@playwright/test';
import { testServer } from './auth';

for (const width of [390, 1024, 1440]) {
  test(`family account handoff and shared list at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const users = [{ id: 'owner', username: 'owner', display_name: 'Owner', admin: true }];
    const members: object[] = [{ user_id: 'owner', username: 'owner', role: 'owner' }];
    let failed = false;
    const grants: unknown[] = [];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      const method = route.request().method();
      let json: unknown = [];
      if (path === '/auth/me') json = users[0];
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries')
        json = [{ id: 'family', name: 'Family books', effective: true, role: 'owner' }];
      if (path === '/libraries/family/members') json = members;
      if (path.startsWith('/libraries/family/members/') && method === 'PUT') {
        grants.push(route.request().postDataJSON());
        members.push({ user_id: 'reader', username: 'sam', role: 'reader' });
        await route.fulfill({ status: 204 });
        return;
      }
      if (path === '/users' && method === 'GET') json = users;
      if (path === '/users' && method === 'POST') {
        if (!failed) {
          failed = true;
          await route.fulfill({ status: 400, body: 'Username already exists' });
          return;
        }
        users.push({ id: 'reader', username: 'sam', display_name: 'Sam', admin: false });
        json = { user: users[1], temporary_password: 'test-only-temporary' };
      }
      if (path === '/collections/shared/list')
        json = {
          id: 'list',
          title: 'Bedtime reading',
          description: 'Read together',
          shared_library_id: 'family',
          shared_library_name: 'Family books',
          owner_name: 'Sam',
          can_edit: false,
          work_count: 1,
          works: [{ id: 'book', title: 'Alice', author: 'Lewis Carroll', position: 0 }],
        };
      await route.fulfill({ json });
    });
    await page.goto('/users');
    await page.getByRole('button', { name: 'Add user', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user', exact: true });
    await dialog.getByRole('textbox', { name: 'Username', exact: true }).fill('sam');
    await dialog.getByRole('textbox', { name: 'Display name', exact: true }).fill('Sam');
    await expect(
      dialog.getByRole('button', { name: 'Create account', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Family books', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(dialog.getByText('Username already exists', { exact: true })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/family/${width}-add-user.png`,
    });
    await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
    const handoff = page.getByRole('dialog', { name: 'One-time sign-in', exact: true });
    await expect(handoff.getByText('test-only-temporary', { exact: true })).toBeVisible();
    await expect.poll(() => grants.length).toBe(1);
    expect(grants[0]).toMatchObject({ role: 'reader', can_request_acquisitions: false });
    expect(
      await handoff.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/family/${width}-handoff.png`,
    });
    await handoff.getByRole('button', { name: 'I saved it', exact: true }).click();
    await page.getByRole('button', { name: 'View', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Sam', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset password', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Admin note', exact: true })).toHaveCount(0);
    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: `../artifacts/family/${width}-manage-user.png`,
    });
    await page.getByRole('button', { name: 'Make administrator', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Change administrator access', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Reset password?', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Add private note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Admin note', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to users', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search users', exact: true })).toBeVisible();
    await page.goto('/collection/list?shared=1');
    await expect(
      page.getByText('Only the creator can edit this list.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/family/${width}-shared-list.png`,
    });
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1024, 1440]) {
  test(`remembered reader still requires a password at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((origin) => {
      localStorage.setItem(
        `aldus:remembered-accounts:${encodeURIComponent(origin)}`,
        JSON.stringify([
          { id: 'sam', username: 'sam', display_name: 'Sam' },
          { id: 'parent', username: 'parent', display_name: 'Parent' },
        ]),
      );
    }, testServer);
    let loginAttempts = 0;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      if (path === '/auth/me') {
        await route.fulfill({ status: 401, body: 'Sign in required' });
        return;
      }
      if (path === '/auth/login') {
        loginAttempts++;
        await route.fulfill({ status: 401, body: 'invalid credentials' });
        return;
      }
      await route.fulfill({ json: path === '/setup/status' ? { available: false } : [] });
    });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Parent', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(
      'parent',
    );
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
    await expect(signIn).toBeDisabled();
    expect(loginAttempts).toBe(0);
    await page.getByLabel('Password', { exact: true }).fill('incorrect');
    await signIn.click();
    await expect(
      page.getByText('Username or password is incorrect.', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/login/);
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/family/${width}-reader-login.png`,
    });
    await page.getByRole('button', { name: 'Forget', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Sam', exact: true })).toHaveCount(0);
  });
}
