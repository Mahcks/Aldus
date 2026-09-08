import { expect, test } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  test(`choose which imported book fulfills a request at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let approved = false;
    let attempts = 0;
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', display_name: 'Owner', admin: true };
      if (path === '/acquisition-settings')
        json = {
          indexer_kind: 'prowlarr',
          indexer_url: 'http://prowlarr:9696',
          qbittorrent_url: 'http://qbittorrent:8080',
          qbittorrent_username: 'reader',
          qbittorrent_category: 'aldus',
          qbittorrent_download_root: '/downloads',
        };
      if (path === '/libraries/family/title-requests/page')
        json = [
          {
            id: 'title-request',
            library_id: 'family',
            title: 'Alice’s Adventures in Wonderland',
            author: 'Lewis Carroll',
            requested_by: 'owner',
            created_at: '2026-09-06T12:00:00Z',
            updated_at: '2026-09-06T12:00:00Z',
            formats: [
              {
                format: 'ebook',
                state: approved ? 'wanted' : 'pending_approval',
                updated_at: '2026-09-06T12:00:00Z',
              },
            ],
          },
        ];
      if (path.endsWith('/approve')) {
        approved = true;
        json = {};
      }
      if (path === '/libraries/family/acquisition-requests')
        json = [
          {
            id: 'download',
            query: 'Treasure Island',
            selected_title: 'Treasure Island — unabridged audiobook',
            selected_source: 'Family catalog',
            selected_size: 104857600,
            updated_at: '2026-09-06T12:00:00Z',
            fulfillment_state: 'failed',
            download_error: 'download client unavailable',
          },
        ];
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'owner' }];
      if (path === '/libraries/family/sources')
        json = [
          {
            id: 'source',
            name: 'Family audiobook folder',
            enabled: true,
            root_path: '/books',
            auto_import: false,
          },
        ];
      if (path === '/source-roots')
        json = [{ id: 'root', label: 'Books', path: '/books', available: true }];
      if (path === '/source-roots/root/directories') {
        const nested = new URL(route.request().url()).searchParams.get('path') === 'Kids';
        json = {
          root_id: 'root',
          relative_path: nested ? 'Kids' : '',
          selected_path: nested ? '/books/Kids' : '/books',
          has_parent: nested,
          directories: nested ? [] : ['Kids'],
        };
      }
      if (path.endsWith('/source/scans'))
        json = [0, 1].map((index) => ({
          id: `scan-${index}`,
          state: 'failed',
          supported: 2,
          problems: 1,
          created_at: '2026-09-06T12:00:00Z',
        }));
      if (path.endsWith('/source/entries'))
        json = [
          {
            id: 'entry',
            relative_path: 'Family/Long audiobook edition/Alice-unabridged.m4b',
            kind: 'audio',
            state: 'failed',
            size_bytes: 104857600,
            error: 'This file could not be read. Check that it is complete.',
            metadata: {},
          },
        ];
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
      if (path === '/libraries/family/title-requests/page' && Array.isArray(json))
        json = { items: json };
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
    await page.getByRole('button', { name: 'Import book', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: `../artifacts/058/${width}-review.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Import book', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Choose files in the requested format');
    await expect(choice).toBeChecked();
    await page.getByRole('button', { name: 'Import book', exact: true }).click();
    await expect.poll(() => submitted?.acquisition_request_id).toBe('request');
    await page.goto('/sources?libraryId=family');
    await expect(page.getByRole('button', { name: 'Scan now', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-sources.png` });
    await page.getByRole('button', { name: 'Source settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit source', exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-source-settings.png` });
    await page.getByRole('button', { name: 'Inspect files (1)', exact: true }).click();
    await expect(page.getByText('Recent scans', { exact: true })).toBeVisible();
    await expect(
      page.getByText('This file could not be read. Check that it is complete.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-source-inventory.png` });
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    const folder = page.getByRole('dialog', { name: 'Add source', exact: true });
    await folder.getByRole('button', { name: 'Open Kids', exact: true }).click();
    await expect(folder.getByRole('textbox', { name: 'Source name', exact: true })).toHaveValue(
      'Kids',
    );
    await expect(folder.getByRole('button', { name: 'Add source', exact: true })).toBeEnabled();
    await expect
      .poll(() =>
        folder.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      )
      .toBe(1);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-source-folder.png` });
    await page.goto('/acquisitions');
    await page.getByRole('tab', { name: 'Requests', exact: true }).click();
    await expect(page.getByRole('button', { name: /Approve ebook request for/ })).toBeVisible();
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-acquisition-approval.png`,
    });
    await page.getByRole('button', { name: /Approve ebook request for/ }).click();
    await expect.poll(() => approved).toBe(true);
    await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await expect(page.getByText('Download failed', { exact: true })).toBeVisible();
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-acquisition-downloads.png`,
    });
    await page.getByRole('tab', { name: 'Connections', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'qBittorrent URL', exact: true })).toHaveValue(
      'http://qbittorrent:8080',
    );
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-acquisition-connections.png`,
      fullPage: true,
    });
  });
}
