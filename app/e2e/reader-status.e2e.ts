import { expect, test } from '@playwright/test';
import { continueReadingHere, signInAsTestAdmin, testServer } from './auth';

test('a fresh EPUB opens its cover without writing an opening position', async ({ page }) => {
  await signInAsTestAdmin(page);
  await page.route('**/reading-session/claim', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({
      response,
      json: { ...(await response.json()), progress: null, representation_states: [] },
    });
  });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/(progress|state)$/.test(request.url()))
      writes.push(request.url());
  });
  await page.goto('/consume/alice-gutenberg-11-work?mode=read');
  await continueReadingHere(page);
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
  expect(writes).toEqual([]);
});

for (const width of [390, 1024, 1440]) {
  test(`reader labels and confirmed save status at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await signInAsTestAdmin(page);
    // Start in aligned text, not the fixture's image-only cover.
    const workURL = `${testServer}/api/v1/works/alice-gutenberg-11-work`;
    const jobs = await (await page.request.get(`${workURL}/alignment-jobs`)).json();
    const job = jobs.find((item: { alignment_id?: string }) => item.alignment_id);
    const alignment = await (
      await page.request.get(`${testServer}/api/v1/alignments/${job.alignment_id}`)
    ).json();
    const segment = alignment.segments.filter(
      (item: { highlightable: boolean; text: string }) =>
        item.highlightable && item.text.length > 30,
    )[20];
    const previous = await page.request.get(`${workURL}/progress`);
    const revision = previous.status() === 404 ? 0 : (await previous.json()).revision;
    const seeded = await page.request.put(`${workURL}/progress`, {
      data: {
        alignment_id: job.alignment_id,
        segment_id: segment.id,
        offset: 0,
        expected_revision: revision,
        source_device: 'status-test',
      },
    });
    expect(seeded.ok()).toBe(true);
    await page.goto('/consume/alice-gutenberg-11-work?mode=read');
    const next = page.getByRole('button', { name: 'Next page', exact: true });
    const claim = page.getByRole('button', { name: 'Continue here', exact: true });
    await expect(next.or(claim)).toBeVisible({ timeout: 30000 });
    if (await claim.isVisible()) await claim.click();
    await expect(next).toBeEnabled({ timeout: 30000 });
    await expect(page.getByText('Ready to read', { exact: true })).toBeVisible();
    // The pager must not change height as the save status changes.
    const pager = next.locator('xpath=..');
    const pagerHeight = async () => (await pager.boundingBox())?.height;
    const readyHeight = await pagerHeight();
    expect(readyHeight).toBeGreaterThan(0);
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
    const locationLabel = page.getByText(/^Location \d+ of \d+/);
    await expect(locationLabel).toBeVisible();
    expect(
      await locationLabel.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(page.getByText(/^\d+ of \d+ pages/)).toHaveCount(0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const pending = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const endpoint = '**/representations/alice-gutenberg-11-epub/state';
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const response = await route.fetch();
      reached();
      await gate;
      await route.fulfill({ response });
    });
    try {
      await next.click();
      await pending;
      await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
      await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
      expect(await pagerHeight()).toBe(readyHeight);
    } finally {
      release();
    }
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(await pagerHeight()).toBe(readyHeight);
    await expect(page.getByText('In sync with audiobook', { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `../artifacts/reader-status/${width}-saved.png`,
      fullPage: true,
    });
    await page.unroute(endpoint);
    await page.route(endpoint, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 503, body: 'Save unavailable for test' })
        : route.continue(),
    );
    await next.click();
    await expect(page.getByText('Couldn’t save', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
    expect(await pagerHeight()).toBe(readyHeight);
  });
}
