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
      if (path === '/works') json = { items: [], offset: 0, has_more: false };
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
            reasons: ['Embedded title and primary author agree.'],
            review_reasons: ['The downloaded book’s title does not confirm the requested book.'],
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
    await expect(
      page.getByRole('dialog').getByText(/Last acquisition review:.*does not confirm/),
    ).toBeVisible();
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
    await expect(page.getByText(/Last acquisition review:.*does not confirm/)).toBeVisible();
    await expect(page.getByText(/Grouping confidence: high/)).toBeVisible();
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

for (const width of [390, 1024, 1440]) {
  test(`find any import destination and preserve selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const books = Array.from({ length: 55 }, (_, index) => ({
      id: `work-${index + 1}`,
      library_id: 'family',
      title: `Book ${String(index + 1).padStart(2, '0')}`,
      author: `Author ${index + 1}`,
    }));
    const proposal = {
      id: 'proposal',
      state: 'review_required',
      confidence: 'high',
      title: 'Imported book',
      author: 'Author',
      reasons: ['An existing book matches these files.'],
      existing_work_id: 'work-55',
      revision: 1,
      items: [
        {
          source_entry_id: 'entry',
          relative_path: 'book.epub',
          kind: 'epub',
          label: 'EPUB',
          evidence: {},
        },
      ],
    };
    let submitted: Record<string, unknown> | undefined;
    let failSearch = true;
    let releaseSlowSearch: (() => void) | undefined;
    let slowSearchFinished = false;
    const requestedOffsets: number[] = [];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me')
        json = { id: 'owner', username: 'owner', display_name: 'Owner', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/libraries') json = [{ id: 'family', name: 'Family', role: 'owner' }];
      if (path === '/libraries/family/import-proposals') json = [proposal];
      if (path === '/works') {
        expect(url.searchParams.get('library_id')).toBe('family');
        const query = url.searchParams.get('q') || '';
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit'));
        expect(limit).toBeLessThanOrEqual(50);
        requestedOffsets.push(offset);
        if (query === 'slow') {
          await new Promise<void>((resolve) => {
            releaseSlowSearch = resolve;
          });
          json = {
            items: [{ ...books[0], id: 'stale', title: 'Stale response' }],
            has_more: false,
            offset: 0,
          };
        } else if (query === 'retry' && failSearch) {
          await route.fulfill({ status: 503, body: 'Book search unavailable' });
          return;
        } else {
          const matching =
            query === 'retry'
              ? books
              : books.filter((work) =>
                  `${work.title} ${work.author}`.toLowerCase().includes(query.toLowerCase()),
                );
          json = {
            items: matching.slice(offset, offset + limit),
            offset,
            has_more: offset + limit < matching.length,
          };
        }
      }
      if (/^\/works\/work-\d+$/.test(path))
        json = books.find((work) => path.endsWith(`/${work.id}`));
      if (path.endsWith('/accept')) {
        submitted = route.request().postDataJSON();
        json = { work_id: submitted?.work_id };
      }
      await route.fulfill({ json });
      if (url.searchParams.get('q') === 'slow') slowSearchFinished = true;
    });

    await page.goto('/sources?libraryId=family&proposalId=proposal');
    const dialog = page.getByRole('dialog', { name: 'Review import proposal' });
    const search = dialog.getByRole('textbox', { name: 'Find an existing book' });
    await expect(dialog.getByRole('radio', { name: 'Book 55', exact: true })).toBeChecked();
    await expect(dialog.getByText('Author 55 · Suggested match')).toBeVisible();
    await dialog
      .getByRole('textbox', { name: 'Book title', exact: true })
      .fill('Keep my title edit');
    await dialog.getByRole('button', { name: 'Load more books' }).click();
    await dialog.getByRole('button', { name: 'Load more books' }).click();
    await expect(dialog.getByRole('radio', { name: 'Book 51', exact: true })).toBeVisible();
    await dialog.getByRole('radio', { name: 'Book 51', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Book 51', exact: true })).toBeChecked();
    expect(requestedOffsets).toEqual(expect.arrayContaining([0, 20, 40]));
    await search.fill('no matching title');
    await expect(dialog.getByText('No books found', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Book 51', exact: true })).toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'Book title', exact: true })).toHaveValue(
      'Keep my title edit',
    );
    await search.fill('retry');
    await expect(dialog.getByText('Could not load books', { exact: true })).toBeVisible();
    failSearch = false;
    await dialog.getByRole('button', { name: 'Retry book search' }).click();
    await expect(dialog.getByRole('radio', { name: 'Book 01', exact: true })).toBeVisible();
    await search.fill('slow');
    await expect.poll(() => Boolean(releaseSlowSearch)).toBe(true);
    await search.fill('Book 51');
    await expect(dialog.getByRole('button', { name: 'Load more books' })).toHaveCount(0);
    releaseSlowSearch!();
    await expect.poll(() => slowSearchFinished).toBe(true);
    await expect(dialog.getByRole('radio', { name: 'Stale response' })).toHaveCount(0);
    await expect(dialog.getByRole('radio', { name: 'Book 51', exact: true })).toBeChecked();
    await search.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../artifacts/068/${width}-import-destination.png`,
      animations: 'disabled',
      fullPage: true,
    });
    await dialog.getByRole('button', { name: 'Import book', exact: true }).click();
    await expect.poll(() => submitted?.work_id).toBe('work-51');
    expect(submitted?.title).toBe('Keep my title edit');
  });
}

test('destination failures, stale selections and library changes cannot redirect an import', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const book = { id: 'work', library_id: 'family', title: 'Family book', author: 'Family author' };
  const proposal = {
    id: 'one',
    state: 'review_required',
    confidence: 'high',
    title: 'First proposal',
    author: 'Author',
    reasons: [],
    existing_work_id: 'work',
    revision: 1,
    items: [
      {
        source_entry_id: 'entry',
        relative_path: 'book.epub',
        kind: 'epub',
        label: 'EPUB',
        evidence: {},
      },
    ],
  };
  let failSelection = true;
  let releaseSelection: (() => void) | undefined;
  let selectionFinished = false;
  const accepted: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/me')
      json = { id: 'owner', username: 'owner', display_name: 'Owner', admin: true };
    if (path === '/setup/status') json = { available: false };
    if (path === '/libraries')
      json = [
        { id: 'family', name: 'Family', role: 'owner' },
        { id: 'other', name: 'Other', role: 'owner' },
      ];
    if (path === '/libraries/family/import-proposals')
      json = [
        proposal,
        { ...proposal, id: 'two', title: 'Second proposal', existing_work_id: 'slow' },
      ];
    if (path === '/libraries/other/import-proposals')
      json = [
        { ...proposal, id: 'other-proposal', title: 'Other proposal', existing_work_id: 'foreign' },
      ];
    if (path === '/works')
      json = {
        items: url.searchParams.get('library_id') === 'family' ? [book] : [],
        has_more: false,
        offset: 0,
      };
    if (path === '/works/work') {
      if (failSelection) {
        await route.fulfill({ status: 503, body: 'Selected book unavailable' });
        return;
      }
      json = book;
    }
    if (path === '/works/slow') {
      await new Promise<void>((resolve) => {
        releaseSelection = resolve;
      });
      json = { ...book, id: 'slow', title: 'Stale selected book' };
    }
    if (path === '/works/foreign') json = book; // Accessible, but belongs to another library.
    if (path === '/works/work/representations')
      json = [{ id: 'edition', work_id: 'work', kind: 'epub', label: 'Existing EPUB' }];
    if (path.endsWith('/accept')) {
      accepted.push(route.request().postDataJSON());
      json = { work_id: 'imported' };
    }
    await route.fulfill({ json });
    if (path === '/works/slow') selectionFinished = true;
  });
  await page.goto('/sources?libraryId=family');
  await page.getByRole('tab', { name: 'Family', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review proposal', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Review proposal', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Review import proposal' });
  await expect(dialog.getByRole('button', { name: 'Retry selected book' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import book', exact: true })).toBeDisabled();
  failSelection = false;
  await dialog.getByRole('button', { name: 'Retry selected book' }).click();
  await expect(dialog.getByRole('radio', { name: 'Family book', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Existing EPUB', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Family book', exact: true }).click();
  await dialog.getByRole('button', { name: 'Import book', exact: true }).click();
  await expect.poll(() => accepted.length).toBe(1);
  expect(accepted[0].items).toEqual([expect.objectContaining({ representation_id: 'edition' })]);

  await page.getByRole('button', { name: 'Review proposal', exact: true }).nth(1).click();
  await expect.poll(() => Boolean(releaseSelection)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Import book', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('tab', { name: 'Other', exact: true }).click();
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click();
  await expect(
    dialog.getByText('This book is no longer in this library. Choose another destination.'),
  ).toBeVisible();
  releaseSelection!();
  await expect.poll(() => selectionFinished).toBe(true);
  await expect(dialog.getByRole('radio', { name: 'Stale selected book' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Existing EPUB', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Import book', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Create a new book' }).click();
  await expect(dialog.getByRole('button', { name: 'Import book', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import book', exact: true }).click();
  await expect.poll(() => accepted.length).toBe(2);
  expect(accepted[1].work_id).toBe('');
  expect(accepted[1].title).toBe('Other proposal');
});
