import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`choose which imported book fulfills a request at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let attempts = 0;
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', display_name: 'Owner', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'owner' }];
      if (path === '/libraries/family/import-proposals')
        json = [
          {
            id: 'one',
            library_id: 'family',
            state: 'review_required',
            confidence: 'high',
            title: 'Alice in Wonderland',
            author: 'Lewis Carroll',
            reasons: ['Multiple books found in this download.'],
            revision: 1,
            acquisition_request_id: 'request',
            acquisition_title: 'Alice in Wonderland',
            items: [
              {
                source_entry_id: 'entry',
                relative_path: 'Alice.epub',
                kind: 'epub',
                label: 'EPUB',
                evidence: {},
              },
            ],
          },
        ];
      if (path.endsWith('/accept')) {
        attempts++;
        if (attempts === 1) {
          await route.fulfill({
            status: 400,
            body: 'Choose files in the requested format and the requested book.',
          });
          return;
        }
        submitted = route.request().postDataJSON();
        json = { work_id: 'work' };
      }
      await route.fulfill({ json });
    });
    await page.goto('/sources?libraryId=family&proposalId=one');
    const choice = page.getByRole('checkbox', {
      name: 'Fulfill request for “Alice in Wonderland” with this book',
    });
    await expect(choice).not.toBeChecked();
    await choice.scrollIntoViewIfNeeded();
    await choice.click();
    await expect(choice).toBeChecked();
    await choice.press('Space');
    await expect(choice).not.toBeChecked();
    await choice.press('Space');
    await expect(choice).toBeChecked();
    await page
      .getByRole('button', { name: 'Create Work and import', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/058/${width}-review.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Create Work and import', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Choose files in the requested format');
    await expect(choice).toBeChecked();
    await page.getByRole('button', { name: 'Create Work and import', exact: true }).click();
    await expect.poll(() => submitted?.acquisition_request_id).toBe('request');
  });
}
