import { expect, test } from '@playwright/test';

for (const path of ['/libraries', '/library/public']) {
  test(`primary saves are serialized on ${path}`, async ({ page }) => {
    let primary = 'public';
    let release: (() => void) | undefined;
    let writes = 0;
    const libraries = ['public', 'kids'].map((id) => ({
      id,
      name: id === 'public' ? 'Public' : 'Kids',
      role: 'owner',
      effective: true,
      primary: id === 'public',
      work_count: 0,
      member_count: 1,
    }));
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (endpoint === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
      if (endpoint === '/setup/status') json = { available: false };
      if (endpoint === '/libraries') json = libraries;
      if (endpoint === '/libraries/public') json = libraries[0];
      if (endpoint === '/works') json = { items: [], has_more: false };
      if (endpoint.endsWith('/acquisition-policy'))
        json = { allowed_ebook_extensions: [], preferred_language: '' };
      if (endpoint.endsWith('/primary')) {
        writes++;
        primary = endpoint.split('/')[2];
        if (writes === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto(path);
    if (path !== '/libraries')
      await page.getByRole('button', { name: /Switch library, currently Public/ }).click();
    await page.getByRole('button', { name: 'Make Kids your primary library', exact: true }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Public is your primary library', exact: true }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    release!();
    await expect(
      page.getByRole('button', { name: 'Kids is your primary library', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Make Public your primary library', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Public is your primary library', exact: true }),
    ).toBeVisible();
    expect(primary).toBe('public');
    expect(writes).toBe(2);
  });
}

for (const effective of [true, false]) {
  test(`Library default respects primary access: ${effective}`, async ({ page }) => {
    const requestedLibraries: (string | null)[] = [];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries')
        json = [
          { id: 'public', name: 'Public', effective: true, primary: false },
          { id: 'kids', name: 'Kids', effective, primary: true },
        ];
      if (path === '/works') {
        requestedLibraries.push(url.searchParams.get('library_id'));
        json = { items: [], has_more: false };
      }
      if (path.startsWith('/catalog/')) json = { items: [], has_more: false };
      await route.fulfill({ json });
    });
    await page.goto('/books');
    await expect.poll(() => requestedLibraries.length).toBeGreaterThan(0);
    expect(requestedLibraries).toEqual([effective ? 'kids' : null]);
  });
}
