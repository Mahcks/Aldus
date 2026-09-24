import { expect, test } from '@playwright/test';

for (const hash of ['', 'a'.repeat(64)]) {
  test(`file details remain accessible ${hash ? 'with' : 'without'} a hash`, async ({ page }) => {
    const path =
      'Suzanne Collins/An audiobook with a very long directory name/Disc 01/Chapter 001.mp3';
    await page.route('**/api/**', async (route) => {
      const endpoint = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (endpoint === '/auth/me') json = { id: 'admin', username: 'admin', admin: true };
      if (endpoint === '/setup/status') json = { available: false };
      if (endpoint === '/libraries')
        json = [{ id: 'lib', name: 'Library', role: 'owner', effective: true }];
      if (endpoint === '/libraries/lib/sources')
        json = [{ id: 'source', name: 'Audiobooks', enabled: true }];
      if (endpoint.endsWith('/entries'))
        json = [
          {
            id: 'entry',
            relative_path: path,
            sha256: hash,
            kind: 'audio',
            size_bytes: 1024,
            state: hash ? 'registered' : 'error',
            error: hash ? '' : 'file exceeds scan limit',
          },
        ];
      if (endpoint === '/me/notifications/unread-count') json = { unread_count: 0 };
      await route.fulfill({ json });
    });
    await page.goto('/sources');
    await page.getByRole('button', { name: 'Show details for Audiobooks', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect files (1)', exact: true }).click();
    await page
      .getByRole('button', { name: `Show technical details for ${path}`, exact: true })
      .click();
    await expect(page.getByText('File path', { exact: true })).toBeVisible();
    const fullPath = page.getByText(path, { exact: true }).last();
    await expect(fullPath).toBeVisible();
    expect(await fullPath.evaluate((node) => getComputedStyle(node).textOverflow)).not.toBe(
      'ellipsis',
    );
    await expect(page.getByText('SHA-256', { exact: true })).toHaveCount(hash ? 1 : 0);
    if (hash) await expect(page.getByText(hash, { exact: true })).toBeVisible();
    else await expect(page.getByText('file exceeds scan limit', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: `Hide technical details for ${path}`, exact: true })
      .click();
    await expect(page.getByText('File path', { exact: true })).toHaveCount(0);
  });
}
