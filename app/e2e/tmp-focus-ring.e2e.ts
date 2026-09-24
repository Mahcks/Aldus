import { expect, test } from '@playwright/test';

test('a mouse click does not leave a lingering focus ring, but Tab navigation still shows one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'owner', admin: true };
    if (path === '/setup/status') json = { available: false };
    if (path === '/libraries')
      json = [
        {
          id: 'a',
          name: 'Alpha',
          role: 'owner',
          exclusive: false,
          effective: true,
          primary: true,
          work_count: 0,
          member_count: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'b',
          name: 'Beta',
          role: 'owner',
          exclusive: false,
          effective: true,
          primary: false,
          work_count: 0,
          member_count: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    await route.fulfill({ json });
  });

  await page.goto('/libraries');
  const addButton = page.getByRole('button', { name: 'Add library', exact: true });
  await expect(addButton).toBeVisible();

  // Mouse click: focus lands here (RN Web focuses on click), but it must not show the ring.
  // Doesn't navigate away (opens a dialog in place), so the element stays put to check.
  await addButton.click();
  const clickedOutline = await addButton.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(clickedOutline).not.toBe('solid');

  // Keyboard: Tab should still visibly focus something with the ring.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const tabbedOutline = await page.evaluate(() => {
    const active = document.activeElement;
    return active ? getComputedStyle(active).outlineStyle : 'none';
  });
  expect(tabbedOutline).toBe('solid');
});
