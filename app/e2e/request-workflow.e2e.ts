import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ImportProposal, TitleRequest } from '../src/generated/api';

let service: ChildProcess;
let fixture: { url: string; reader: string; owner: string };
let output = '';

test.beforeAll(async () => {
  service = spawn(
    'go',
    [
      'test',
      './internal/api/v1',
      '-run',
      '^TestRequestWorkflowFixture$',
      '-count=1',
      '-v',
      '-timeout=12m',
    ],
    {
      cwd: '../server',
      env: { ...process.env, ALDUS_REQUEST_E2E: '1' },
    },
  );
  service.stdout!.on('data', (data) => {
    output += data.toString();
    const match = output.match(/ALDUS_REQUEST_FIXTURE=(.+)\n/);
    if (match) fixture = JSON.parse(match[1]);
  });
  service.stderr!.on('data', (data) => {
    output += data.toString();
  });
  await expect
    .poll(() => Boolean(fixture), { timeout: 45_000, message: 'Start isolated request service' })
    .toBe(true);
});

test.afterAll(async ({ request }) => {
  if (fixture) await request.post(`${fixture.url}/stop`);
  else service?.kill();
});

const book = {
  title: "Alice's Adventures in Wonderland",
  author: 'Lewis Carroll',
  external_source: 'open_library',
  external_id: 'OL059W',
  readable: false,
  listenable: false,
  synchronized: false,
};

async function connect(page: Page, token: string) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/discover/trending') {
      await route.fulfill({
        json: [{ source: 'open_library', title: 'Explore something new', items: [book] }],
      });
    } else if (path === '/discover/detail') {
      await route.fulfill({ json: { description: 'Follow Alice down the rabbit hole.' } });
    } else if (path === '/search/titles') {
      await route.fulfill({ json: [book] });
    } else {
      const response = await route.fetch({
        url: `${fixture.url}${url.pathname}${url.search}`,
        headers: { ...route.request().headers(), authorization: `Bearer ${token}` },
      });
      await route.fulfill({ response });
    }
  });
}

async function apiJSON(request: APIRequestContext, path: string, token: string, data?: unknown) {
  const response = await request.fetch(`${fixture.url}/api/v1${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}` },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.status() === 204 ? undefined : response.json();
}

for (const [index, library] of ['family', 'review', 'retry'].entries()) {
  const width = [390, 1024, 1440][index];
  test(`reader → owner → real import → ebook at ${width}px (${library})`, async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const initialAdds = (await (await request.get(`${fixture.url}/stats`)).json()).adds;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await connect(page, fixture.reader);
    await page.goto('/search');
    await page
      .getByRole('button', { name: `${book.title} by ${book.author}`, exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Book details' });
    await expect(dialog.getByRole('button', { name: 'Request ebook', exact: true })).toBeDisabled();
    await dialog
      .getByRole('radio', { name: library[0].toUpperCase() + library.slice(1), exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: 'Request audiobook', exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: `../artifacts/requests/${width}-request-library.png` });
    // Keyboard activation exercises the same real create endpoint as a tap.
    const submit = dialog.getByRole('button', { name: 'Request ebook', exact: true });
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Awaiting approval', { exact: true })).toBeVisible();

    const listed = await apiJSON(
      request,
      `/libraries/${library}/title-requests/page?own=true&filter=active`,
      fixture.reader,
    );
    const created: TitleRequest = listed.items[0];
    const repeated: TitleRequest = await apiJSON(
      request,
      `/libraries/${library}/title-requests`,
      fixture.reader,
      {
        work_id: '',
        external_source: book.external_source,
        external_id: book.external_id,
        title: book.title,
        author: book.author,
        cover_url: '',
        formats: ['ebook'],
      },
    );
    expect(repeated.id).toBe(created.id);
    expect(
      (await apiJSON(request, `/libraries/${library}/title-requests/page?own=true`, fixture.reader))
        .items,
    ).toHaveLength(1);
    await dialog.getByRole('button', { name: 'View request', exact: true }).click();
    await expect(page.getByText('Awaiting approval', { exact: true }).first()).toBeVisible();

    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const owner = await ownerContext.newPage();
    await connect(owner, fixture.owner);
    await owner.goto('/acquisitions');
    await owner.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(owner.getByText('Requested', { exact: true })).toBeVisible();
    if (library === 'review')
      expect((await request.post(`${fixture.url}/payload?review=true`)).ok()).toBe(true);
    if (library === 'retry')
      expect((await request.post(`${fixture.url}/payload?fail=true`)).ok()).toBe(true);

    const requestPath = `/libraries/${library}/title-requests/${created.id}`;
    async function advance() {
      const tick = await request.post(`${fixture.url}/tick`);
      expect(tick.ok(), await tick.text()).toBe(true);
      return apiJSON(request, requestPath, fixture.reader) as Promise<TitleRequest>;
    }
    const expected =
      library === 'review' ? 'needs_review' : library === 'retry' ? 'failed' : 'available';
    await expect
      .poll(async () => (await advance()).formats[0].state, { timeout: 30_000 })
      .toBe(expected);

    if (library === 'review') {
      const proposals: ImportProposal[] = await apiJSON(
        request,
        `/libraries/${library}/import-proposals`,
        fixture.owner,
      );
      const downloads = await apiJSON(
        request,
        `/libraries/${library}/acquisition-requests`,
        fixture.owner,
      );
      const proposal = proposals.find((item) => item.id === downloads[0].proposal_id)!;
      expect(proposal).toBeTruthy();
      await apiJSON(
        request,
        `/libraries/${library}/import-proposals/${proposal.id}/accept`,
        fixture.owner,
        {
          expected_revision: proposal.revision,
          acquisition_request_id: proposal.acquisition_request_id,
          title: proposal.title,
          author: proposal.author,
          items: proposal.items
            .slice(0, 1)
            .map((item) => ({
              source_entry_id: item.source_entry_id,
              kind: item.kind,
              label: item.label,
            })),
        },
      );
    }
    if (library === 'retry') {
      expect((await request.post(`${fixture.url}/payload?fail=false`)).ok()).toBe(true);
      const downloads = await apiJSON(
        request,
        `/libraries/${library}/acquisition-requests`,
        fixture.owner,
      );
      await apiJSON(
        request,
        `/libraries/${library}/acquisition-requests/${downloads[0].id}/retry`,
        fixture.owner,
        {},
      );
    }
    await expect
      .poll(async () => (await advance()).formats[0].state, { timeout: 30_000 })
      .toBe('available');
    const ready = await advance();
    expect((await (await request.get(`${fixture.url}/stats`)).json()).adds).toBe(initialAdds + 1);
    expect(ready.library_id).toBe(library);
    expect(ready.requested_by).toBe('reader');
    expect(ready.work_id).toBeTruthy();
    // Activity must update in place; no reload or tab switch.
    await expect(page.getByRole('button', { name: 'Read', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: `../artifacts/requests/${width}-request-ready.png` });
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/consume/${ready.work_id}.*mode=read`));
    await expect(page.getByRole('button', { name: 'Open reader settings' })).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(`/work/${ready.work_id}`);
    await expect(
      page.getByText(`Request in ${library[0].toUpperCase() + library.slice(1)}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Request audiobook', exact: true }),
    ).toBeDisabled();
    const policy = await apiJSON(
      request,
      `/libraries/${library}/acquisition-policy`,
      fixture.owner,
    );
    delete policy.library_id;
    delete policy.updated_at;
    const savedPolicy = await request.put(
      `${fixture.url}/api/v1/libraries/${library}/acquisition-policy`,
      {
        headers: { authorization: `Bearer ${fixture.owner}` },
        data: { ...policy, default_audiobook_source_id: `managed-${library}` },
      },
    );
    expect(savedPolicy.ok(), await savedPolicy.text()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Request audiobook', exact: true }).click();
    await expect(page.getByText('Awaiting approval', { exact: true }).first()).toBeVisible();
    const missing = await apiJSON(
      request,
      `/libraries/${library}/title-requests/page?own=true&filter=active&work_id=${ready.work_id}`,
      fixture.reader,
    );
    expect(missing.items).toHaveLength(1);
    expect(missing.items[0]).toMatchObject({ work_id: ready.work_id, library_id: library });
    expect(missing.items[0].formats[0].format).toBe('audiobook');
    await apiJSON(
      request,
      `/libraries/${library}/title-requests/${missing.items[0].id}/formats/audiobook/cancel`,
      fixture.reader,
      {},
    );
    expect(errors).toEqual([]);
    await ownerContext.close();
  });
}
