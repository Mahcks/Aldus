import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`collection browsing and arrangement at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const collection = {
      id: 'list',
      title: 'Read together',
      description: 'Stories for slow Sunday afternoons.',
      work_count: 2,
      works: [
        {
          id: 'alice',
          title: 'Alice’s Adventures in Wonderland',
          author: 'Lewis Carroll',
          position: 0,
        },
        { id: 'treasure', title: 'Treasure Island', author: 'Robert Louis Stevenson', position: 1 },
      ],
    };
    let order: string[] = [];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'alex', admin: false };
      if (path === '/me/collections') json = [collection];
      if (path === '/setup/status') json = { available: false };
      if (path === '/me/collections/list') {
        if (route.request().method() === 'PUT')
          Object.assign(collection, route.request().postDataJSON());
        json = collection;
      }
      if (path === '/me/collections/list/works/order')
        order = route.request().postDataJSON().work_ids;
      await route.fulfill({ json });
    });
    await page.goto('/collection/list');
    const arrange = page.getByRole('button', { name: 'Arrange books', exact: true });
    await expect(arrange).toBeVisible();
    await expect(page.getByRole('button', { name: /Move .* up/ })).toHaveCount(0);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-collection.png` });
    await arrange.click();
    await page.getByRole('button', { name: 'Move Treasure Island up', exact: true }).click();
    await expect.poll(() => order).toEqual(['treasure', 'alice']);
    await expect(
      page.getByRole('button', { name: 'Move Treasure Island up', exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-collection-arrange.png` });
    await page.getByRole('button', { name: 'Done arranging', exact: true }).click();
    await expect(page.getByRole('button', { name: /Remove .* from collection/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit collection', exact: true });
    await edit.getByRole('textbox', { name: 'Name', exact: true }).fill('Family favorites');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect.poll(() => collection.title).toBe('Family favorites');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await edit.getByRole('button', { name: 'Delete collection', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Delete collection?', exact: true }),
    ).toBeVisible();
    await page.goto('/collections');
    await expect(page.getByText('Family favorites', { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-collections.png` });
  });
}
