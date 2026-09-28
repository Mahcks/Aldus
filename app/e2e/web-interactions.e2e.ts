import { expect, test, type Locator, type Page } from '@playwright/test';

/** The ⋯ button is revealed by fading its wrapper, not the button itself. */
function revealOpacity(button: Locator) {
  return button.evaluate((element) => getComputedStyle(element.parentElement!).opacity);
}

const now = new Date().toISOString();

const library = {
  id: 'public',
  name: 'Public',
  role: 'owner',
  exclusive: false,
  effective: true,
  primary: true,
  work_count: 2,
  member_count: 1,
  created_at: now,
  updated_at: now,
};

const works = [
  {
    id: 'dracula',
    library_id: 'public',
    title: 'Dracula',
    author: 'Bram Stoker',
    readable: true,
    listenable: true,
  },
  {
    id: 'emma',
    library_id: 'public',
    title: 'Emma',
    author: 'Jane Austen',
    readable: true,
    listenable: false,
  },
];

async function mockAPI(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me') json = { id: 'owner', username: 'max', admin: true };
    if (path === '/setup/status') json = { available: false };
    if (path === '/libraries') json = [library];
    if (path === '/libraries/public') json = library;
    if (path === '/works') json = { items: works, has_more: false, offset: 0 };
    if (path.startsWith('/catalog/')) json = { items: [], has_more: false };
    await route.fulfill({ json });
  });
}

test.describe('web interactions at 1440px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockAPI(page);
  });

  test('book cards are links with a hover menu and a right-click menu', async ({ page }) => {
    await page.goto('/books');
    const card = page.getByRole('link', { name: 'Dracula by Bram Stoker', exact: true });
    await expect(card).toHaveAttribute('href', '/work/dracula');

    const actionsButton = page.getByRole('button', { name: 'Actions for Dracula', exact: true });
    await card.hover();
    await expect(actionsButton).toBeVisible();
    await expect.poll(() => revealOpacity(actionsButton)).toBe('1');
    await actionsButton.click();

    const menu = page.getByRole('menu', { name: 'Actions for Dracula', exact: true });
    await expect(menu).toBeVisible();
    for (const name of ['Book details', 'Read', 'Listen', 'Add to collection', 'Reading status']) {
      await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    const firstItem = menu.getByRole('menuitem', { name: 'Book details', exact: true });
    await expect(firstItem).toBeFocused();
    // Opened by mouse: the first row takes focus for the arrow keys but is not highlighted.
    await expect(firstItem).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('ArrowDown');
    const readItem = menu.getByRole('menuitem', { name: 'Read', exact: true });
    await expect(readItem).toBeFocused();
    await expect(readItem).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: '../artifacts/web-interactions/1440-book-menu.png' });

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(actionsButton).toBeFocused();

    // Going straight from one open menu to another book's ⋯ leaves only the new one showing.
    await card.hover();
    await actionsButton.click();
    await expect(menu).toBeVisible();
    const emmaCard = page.getByRole('link', { name: 'Emma by Jane Austen', exact: true });
    const emmaActions = page.getByRole('button', { name: 'Actions for Emma', exact: true });
    await emmaCard.hover();
    await emmaActions.click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('menu', { name: 'Actions for Emma', exact: true })).toBeVisible();
    await expect.poll(() => revealOpacity(actionsButton)).toBe('0');
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Emma by Jane Austen', exact: true }).click({
      button: 'right',
    });
    const emmaMenu = page.getByRole('menu', { name: 'Actions for Emma', exact: true });
    await expect(emmaMenu).toBeVisible();
    await expect(emmaMenu.getByRole('menuitem', { name: 'Listen', exact: true })).toHaveCount(0);
    await emmaMenu.getByRole('menuitem', { name: 'Reading status', exact: true }).click();
    await expect(page).toHaveURL(/\/work\/emma\?action=status/);
  });

  test('in-progress rows are links with an actions menu', async ({ page }) => {
    await page.goto('/books?status=in_progress');
    await expect(
      page.getByRole('link', { name: 'Dracula by Bram Stoker', exact: true }),
    ).toHaveAttribute('href', '/consume/dracula?mode=read');
    await page.getByRole('button', { name: 'Actions for Dracula', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Actions for Dracula', exact: true });
    await expect(menu.getByRole('menuitem', { name: 'Listen', exact: true })).toBeVisible();
    await page.screenshot({ path: '../artifacts/web-interactions/1440-row-menu.png' });
    await page.keyboard.press('Escape');

    // In progress resumes the book: the link and a plain click go to the same place.
    await page.getByRole('link', { name: 'Dracula by Bram Stoker', exact: true }).click();
    await expect(page).toHaveURL(/\/consume\/dracula\?mode=read/);
  });

  test('sidebar navigation uses real links', async ({ page }) => {
    await page.goto('/books');
    await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute(
      'href',
      '/books',
    );
    await expect(page.getByRole('link', { name: 'Libraries', exact: true })).toHaveAttribute(
      'href',
      '/libraries',
    );
    await page.getByRole('link', { name: 'Libraries', exact: true }).click();
    await expect(page).toHaveURL(/\/libraries$/);
  });

  test('icon buttons name themselves on hover', async ({ page }) => {
    await page.goto('/libraries');
    await page.getByRole('button', { name: 'Manage Public', exact: true }).hover();
    await expect(page.getByText('Manage Public', { exact: true })).toBeVisible();
    await page.screenshot({ path: '../artifacts/web-interactions/1440-tooltip.png' });
  });

  test('library rows are links and headers show breadcrumbs', async ({ page }) => {
    await page.goto('/libraries');
    await expect(
      page.getByRole('link', { name: 'Public, 2 books, 1 member', exact: true }),
    ).toHaveAttribute('href', '/library/public');

    await page.goto('/library/public');
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: 'Libraries', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await page.screenshot({ path: '../artifacts/web-interactions/1440-breadcrumbs.png' });

    await breadcrumb.getByRole('link', { name: 'Libraries', exact: true }).click();
    await expect(page).toHaveURL(/\/libraries$/);
  });
});

test('phones keep the back button and long-press menus at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAPI(page);

  await page.goto('/books');
  await expect(
    page.getByRole('link', { name: 'Dracula by Bram Stoker', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for Dracula', exact: true })).toHaveCount(
    0,
  );

  await page.goto('/library/public');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});

test('menus and dropdowns in dark mode at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await mockAPI(page);

  await page.goto('/books');
  await page.getByRole('button', { name: 'Sort by: Recently added', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Sort by', exact: true })).toBeVisible();
  await page.screenshot({ path: '../artifacts/web-interactions/1024-dark-sort.png' });
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Dracula by Bram Stoker', exact: true }).hover();
  await page.getByRole('button', { name: 'Actions for Dracula', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Actions for Dracula', exact: true })).toBeVisible();
  await page.screenshot({ path: '../artifacts/web-interactions/1024-dark-book-menu.png' });
  await page.keyboard.press('Escape');

  await page.goto('/library/public');
  await page.getByRole('button', { name: 'Library management', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Library management', exact: true })).toBeVisible();
  await page.screenshot({ path: '../artifacts/web-interactions/1024-dark-manage-menu.png' });
});
