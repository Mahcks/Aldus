import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`family roles and collection sharing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const users = [
      { id: 'admin', username: 'alex', display_name: 'Alex', admin: true },
      { id: 'reader', username: 'sam', display_name: 'Sam', admin: false },
    ];
    let membership = {
      user_id: 'reader',
      username: 'sam',
      display_name: 'Sam',
      role: 'reader',
      can_request_acquisitions: false,
      can_bypass_acquisition_approval: false,
      can_advanced_acquisition_request: false,
    };
    let shared = '';
    let rejectSave = false;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/works') json = { items: [], has_more: false };
      if (path === '/libraries/family')
        json = { id: 'family', name: 'Family', role: 'owner', effective: true };
      if (path === '/libraries/family/acquisition-policy')
        json = {
          allowed_ebook_extensions: [],
          allowed_audiobook_extensions: [],
          max_ebook_bytes: 0,
          max_audiobook_bytes: 0,
          max_active_requests: 2,
          preferred_language: 'eng',
        };
      if (path === '/auth/me') json = users[0];
      if (path === '/setup/status') json = { available: false };
      if (path === '/users') json = users;
      if (path === '/libraries')
        json = [{ id: 'family', name: 'Family bedtime stories and audiobooks', effective: true }];
      if (path === '/libraries/family/members/reader' && route.request().method() === 'PUT') {
        membership = { ...membership, ...route.request().postDataJSON() };
        await route.fulfill({ status: 204 });
        return;
      }
      if (path === '/libraries/family/members') json = [membership];
      if (path === '/me/collections/list/sharing') {
        if (rejectSave) {
          await route.fulfill({ status: 400, body: 'A book belongs to another library.' });
          return;
        }
        shared = route.request().postDataJSON().library_id;
      }
      if (path === '/me/collections/list')
        json = {
          id: 'list',
          title: 'Bedtime together',
          can_edit: true,
          works: [],
          shared_library_id: shared,
        };
      await route.fulfill({ json });
    });
    await page.goto('/users');
    await page.getByRole('button', { name: 'View', exact: true }).last().click();
    await page.getByRole('button', { name: 'Change role', exact: true }).click();
    const roles = page.getByRole('radiogroup', {
      name: 'Family bedtime stories and audiobooks access',
    });
    await roles.getByRole('radio', { name: 'Owner', exact: true }).click();
    await expect(roles.getByRole('radio', { name: 'Reader', exact: true })).toBeDisabled();
    await expect(page.getByText('Assign another owner before changing this role.')).toBeVisible();
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-family-role.png`,
      fullPage: true,
    });
    // Reload a reader membership to exercise dependent request permissions.
    membership = { ...membership, role: 'reader' };
    await page.reload();
    await page.getByRole('button', { name: 'View', exact: true }).last().click();
    await expect(page.getByRole('checkbox', { name: 'Download without approval' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Request books', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Download without approval', exact: true }).click();
    await expect.poll(() => membership.can_bypass_acquisition_approval).toBe(true);
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-family-permissions.png`,
      fullPage: true,
    });
    await page.goto('/collection/list');
    await page.getByRole('button', { name: 'Sharing', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share collection', exact: true });
    await dialog
      .getByRole('radio', { name: 'Family bedtime stories and audiobooks', exact: true })
      .click();
    await expect(
      dialog.getByRole('radio', { name: 'Family bedtime stories and audiobooks', exact: true }),
    ).toBeChecked();
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-collection-sharing.png` });
    rejectSave = true;
    await dialog.getByRole('button', { name: 'Save sharing' }).click();
    await expect(dialog.getByText(/Could not change sharing/)).toBeVisible();
    rejectSave = false;
    await dialog.getByRole('button', { name: 'Save sharing' }).click();
    await expect(dialog).toHaveCount(0);
    expect(shared).toBe('family');
    await page.goto('/library/family');
    if (width < 600)
      await page.getByRole('button', { name: 'Library management', exact: true }).click();
    await page.getByRole('button', { name: 'Members', exact: true }).click();
    const access = page.getByRole('dialog', { name: 'Manage members', exact: true });
    await access.getByRole('button', { name: 'Change role', exact: true }).click();
    await access.getByRole('radio', { name: 'Editor', exact: true }).click();
    await expect.poll(() => membership.role).toBe('editor');
    await expect(access.getByRole('checkbox', { name: 'Request books', exact: true })).toHaveCount(
      0,
    );
    await expect
      .poll(() =>
        access.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-library-members.png` });
    await access.getByRole('button', { name: 'Add a member', exact: true }).click();
    await expect(access.getByRole('button', { name: 'Add member', exact: true })).toBeDisabled();
    await access.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (width < 600)
      await page.getByRole('button', { name: 'Library management', exact: true }).click();
    await page.getByRole('button', { name: 'Library settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Library settings', exact: true });
    await settings.getByRole('textbox', { name: 'Library name', exact: true }).fill('');
    await expect(
      settings.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeDisabled();
    await settings.getByRole('textbox', { name: 'Library name', exact: true }).fill('Family');
    await expect
      .poll(() =>
        settings.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-library-settings.png` });
    await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (width < 600)
      await page.getByRole('button', { name: 'Library management', exact: true }).click();
    await page.getByRole('button', { name: 'Acquisition policy', exact: true }).click();
    const policy = page.getByRole('dialog', { name: 'Acquisition policy', exact: true });
    const savePolicy = policy.getByRole('button', { name: 'Save acquisition policy', exact: true });
    await expect(savePolicy).toBeDisabled();
    await expect(
      policy.getByText('Add and enable a source before choosing download destinations.'),
    ).toBeVisible();
    await expect
      .poll(() =>
        policy.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    const saveBounds = await savePolicy.boundingBox();
    expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(1000);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-library-policy.png` });
    await page.goto('/libraries');
    await page.getByRole('button', { name: 'Add library', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Add library', exact: true });
    await expect(
      create.getByRole('button', { name: 'Create library', exact: true }),
    ).toBeDisabled();
    await create.getByRole('textbox', { name: 'Library name', exact: true }).fill('Kids');
    await expect(create.getByRole('button', { name: 'Create library', exact: true })).toBeEnabled();
    await expect
      .poll(() =>
        create.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-library-create.png` });
  });
}
