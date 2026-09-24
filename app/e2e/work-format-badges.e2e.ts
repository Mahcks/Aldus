import { expect, test } from '@playwright/test';
import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

for (const inProgress of [false, true]) {
  test(`book cards show every available format, progress=${inProgress}`, async ({ page }) => {
    const cases = [
      {
        id: 'ebook',
        readable: true,
        listenable: false,
        synchronized: false,
        icons: ['book-open-page-variant-outline'],
      },
      {
        id: 'audio',
        readable: false,
        listenable: true,
        synchronized: false,
        icons: ['headphones'],
      },
      {
        id: 'both',
        readable: true,
        listenable: true,
        synchronized: false,
        icons: ['book-open-page-variant-outline', 'headphones'],
      },
      {
        id: 'synced',
        readable: true,
        listenable: true,
        synchronized: true,
        icons: ['link-variant'],
      },
      { id: 'unavailable', readable: false, listenable: false, synchronized: false, icons: [] },
    ];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'reader', username: 'reader', admin: false };
      if (path === '/setup/status') json = { available: false };
      if (path === '/works')
        json = {
          items: cases.map((item) => ({
            ...item,
            title: item.id,
            author: 'Author',
            in_progress: inProgress,
            completion_percent: 25,
            last_mode: 'read',
          })),
          has_more: false,
        };
      if (path.startsWith('/catalog/')) json = { items: [], has_more: false };
      await route.fulfill({ json });
    });
    await page.goto('/books');
    for (const item of cases) {
      const card = page.getByRole('button', { name: new RegExp(`^${item.id} by Author`) });
      await expect(card).toBeAttached();
      const content = await card.textContent();
      for (const icon of [
        'book-open-page-variant-outline',
        'headphones',
        'link-variant',
      ] as const) {
        expect(content?.includes(String.fromCodePoint(glyphs[icon]))).toBe(
          item.icons.includes(icon),
        );
      }
    }
  });
}
