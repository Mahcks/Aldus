import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`genre editing and system diagnostics at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'owner', username: 'alex', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/genre-tags')
        json = [{ id: 'fantasy', label: 'Fantasy', icon: 'read', keywords: ['fantasy fiction'] }];
      if (path === '/genre-tags/unmatched-subjects')
        json = { items: [], has_more: false, offset: 0 };
      if (path === '/system/diagnostics')
        json = {
          version: 'dev',
          environment: 'production',
          schema_version: 58,
          database_status: 'ok',
          storage_status: 'ok',
          source_roots_configured: 2,
          source_roots_reachable: 1,
          pending_source_scans: 0,
          failed_source_scans: 2,
          pending_alignment_jobs: 0,
          failed_alignment_jobs: 0,
          acquisition_configured: true,
          managed_acquisition_files: 5,
          external_media_excluded: 10,
        };
      await route.fulfill({ json });
    });
    await page.goto('/genre-tags');
    await page.getByRole('button', { name: 'Edit Fantasy genre', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit genre' });
    await expect(dialog.getByRole('textbox', { name: 'Icon', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Change icon', exact: true }).click();
    await dialog
      .getByRole('radiogroup', { name: 'Icon', exact: true })
      .getByRole('radio')
      .first()
      .click();
    await expect(dialog.getByRole('textbox', { name: 'Icon', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
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
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-genre-editor.png` });
    await page.goto('/system');
    await expect(page.getByText('Source scans', { exact: true })).toBeVisible();
    await expect(page.getByText('0 active · 2 failed', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-system-diagnostics.png` });
    await page.getByRole('button', { name: 'Back up now', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-system-recovery.png` });
  });
}
