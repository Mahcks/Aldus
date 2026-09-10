import { expect, test } from '@playwright/test';
import { signInAsTestAdmin, testServer } from './auth';

test('an administrator can read, listen, and configure KOReader safely', async ({ page }) => {
  await signInAsTestAdmin(page);

  await page.goto('/work/alice-gutenberg-11-work');
  await expect(
    page.getByRole('heading', { name: "Alice's Adventures in Wonderland" }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^(Start reading|Continue reading|Read)$/ }).click();

  const settings = page.getByRole('button', { name: 'Open reader settings' });
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Reading place saved')).toBeVisible({ timeout: 10_000 });

  await settings.click();
  await expect(page.getByText('Typography', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close reader settings' }).click();

  // An ordinary format change keeps playback paused.
  const readURL = page.url();
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 });

  await page.goto(readURL);
  await expect(page.getByRole('button', { name: 'Open table of contents' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  await page.getByRole('button', { name: 'CHAPTER I. Down the Rabbit-Hole' }).click();
  await expect(page.getByRole('button', { name: 'Listen from here' })).toBeVisible({
    timeout: 30_000,
  });

  // A synchronized handoff carries the user's intent to continue with narration.
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });

  await page.goto(readURL);
  await expect(page.getByRole('button', { name: 'Open table of contents' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  await page.getByRole('button', { name: 'CHAPTER I. Down the Rabbit-Hole' }).click();
  await expect(page.getByRole('button', { name: 'Listen from here' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Switch to listening' })).toBeEnabled();

  await page.route('**/works/alice-gutenberg-11-work/progress', async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Switch to listening' }).click();
  await expect(page.getByText(/Offline mode/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await page.unroute('**/works/alice-gutenberg-11-work/progress');

  await page.goto('/account');
  await page.getByRole('button', { name: 'Manage reader connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByText(/KOReader needs your server's LAN or HTTPS address/)).toBeVisible();
  await page.getByRole('button', { name: 'Create reader credential' }).click();
  await expect(page.getByText(/Credential created\. Save this password now/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'KOReader setup guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(4);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByText(/Credential created\. Save this password now/).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('saved-page loading shields the book and cannot replace progress with the opening page', async ({
  page,
}) => {
  await signInAsTestAdmin(page);
  const progressURL = `${testServer}/api/v1/works/alice-gutenberg-11-work/progress`;
  const jobs = await (
    await page.request.get(`${testServer}/api/v1/works/alice-gutenberg-11-work/alignment-jobs`)
  ).json();
  const job = jobs.find((item: { alignment_id?: string }) => item.alignment_id);
  const alignment = await (
    await page.request.get(`${testServer}/api/v1/alignments/${job.alignment_id}`)
  ).json();
  const segment = alignment.segments.filter(
    (item: { highlightable: boolean; text: string }) => item.highlightable && item.text.length > 30,
  )[20];
  const previous = await (await page.request.get(progressURL)).json();
  const seeded = await page.request.put(progressURL, {
    data: {
      alignment_id: job.alignment_id,
      segment_id: segment.id,
      offset: 7,
      expected_revision: previous?.revision ?? 0,
      source_device: 'restore-test',
    },
  });
  expect(seeded.ok()).toBe(true);
  const before = await (await page.request.get(progressURL)).json();
  expect(before.segment_id).toBeTruthy();

  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = () => {};
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    // Startup resolves the saved canonical position locally, even if conversion is unavailable.
    await page.route('**/locators/epub', (route) => route.abort('failed'));
    const alignmentURL = `**/alignments/${job.alignment_id}`;
    await page.route(alignmentURL, async (route) => {
      requested();
      await held;
      await route.continue();
    });
    await page.goto('/consume/alice-gutenberg-11-work?mode=read');
    await started;
    await expect(page.getByText('Opening your book…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open reader settings' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open table of contents' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Switch to listening' })).toHaveCount(0);
    await page.mouse.click(width / 2, 450);
    await page.keyboard.press('ArrowRight');
    const during = await (await page.request.get(progressURL)).json();
    expect(during.segment_id).toBe(before.segment_id);
    expect(during.offset).toBe(before.offset);
    expect(during.revision).toBe(before.revision);
    await page.screenshot({
      path: `../artifacts/design-redesign/${width}-reader-opening-cover.png`,
    });
    release();
    await expect(page.getByRole('button', { name: 'Open reader settings' })).toBeVisible();
    await expect(page.getByText(/Returning to your saved page…|Opening your book…/)).toHaveCount(0);
    await page.unroute(alignmentURL);
    await page.unroute('**/locators/epub');
    const after = await (await page.request.get(progressURL)).json();
    expect(after.segment_id).toBe(before.segment_id);
    expect(after.offset).toBe(before.offset);
    expect(after.revision).toBe(before.revision);
  }
});

test('native restore verification accepts search context across paragraph boundaries', async ({
  page,
}) => {
  // Run the native injected predicate against real DOM Ranges. Readium search
  // inserts spaces between paragraphs; textContent does not insert those spaces.
  const { locatorStartVisible } = await import('../plugins/readium-restore.cjs');
  await page.setContent(
    '<p>Earlier paragraph.</p><p>Previous paragraph.</p><p id="saved">The uniquely saved passage.</p><p>Following paragraph.</p>',
  );
  const result = await page.evaluate((source) => {
    const verify = (0, eval)(`(${source})`);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('saved')!);
    const locator = {
      text: {
        before: 'Earlier paragraph. Previous paragraph. ',
        highlight: 'The uniquely saved passage.',
        after: ' Following paragraph.',
      },
    };
    return {
      correct: verify(range, locator),
      wrong: verify(range, { text: { ...locator.text, before: 'Different paragraph. ' } }),
    };
  }, locatorStartVisible.toString());
  expect(result).toEqual({ correct: true, wrong: false });
});
