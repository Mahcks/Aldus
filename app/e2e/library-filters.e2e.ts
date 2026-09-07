import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`Library filter choices stay visible and retain selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const queries: URLSearchParams[] = [];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries')
        json = [
          { id: 'family', name: 'Family library', effective: true },
          {
            id: 'children',
            name: 'Children’s bedtime stories and shared audiobooks',
            effective: true,
          },
        ];
      if (path === '/works') {
        queries.push(url.searchParams);
        json = { items: [], has_more: false };
      }
      if (path.startsWith('/catalog/')) json = { items: [], has_more: false };
      await route.fulfill({ json });
    });
    await page.goto('/books');
    await page.getByRole('button', { name: 'Filter & sort', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter & sort books' });
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
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
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-filters-collapsed.png` });
    await dialog.getByRole('button', { name: 'Sort by: Recently added', exact: true }).click();
    const group = dialog.getByRole('radiogroup', { name: 'Sort by', exact: true });
    for (const name of ['Recently added', 'Recently updated', 'Title A–Z', 'Author A–Z']) {
      await expect(group.getByRole('radio', { name, exact: true })).toBeVisible();
    }
    expect(await group.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
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
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-filters-expanded.png` });
    await group.getByRole('radio', { name: 'Title A–Z', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Sort by: Title A–Z', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Format: All books', exact: true }).click();
    await dialog.getByRole('radio', { name: 'Audiobooks', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('availability')).toBe('listenable');
    await dialog.getByRole('button', { name: 'Library: All libraries', exact: true }).click();
    await dialog
      .getByRole('radio', { name: 'Children’s bedtime stories and shared audiobooks', exact: true })
      .click();
    await expect.poll(() => queries.at(-1)?.get('library_id')).toBe('children');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Filter & sort', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Sort by: Title A–Z', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Sort by: Recently added', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Format: All books', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Library: All libraries', exact: true }),
    ).toBeVisible();
  });
}
