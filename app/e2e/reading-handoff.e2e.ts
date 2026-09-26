import { expect, test } from '@playwright/test';
import { signInAsTestAdmin, testServer } from './auth';

const workID = 'alice-gutenberg-11-work';
const consume = '/consume/' + workID + '?mode=read';

test('independent readers require takeover and the previous reader pauses', async ({ browser }) => {
  test.setTimeout(90000);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await signInAsTestAdmin(first);
    const progressURL = testServer + '/api/v1/works/' + workID + '/progress';
    const jobs = await (
      await first.request.get(testServer + '/api/v1/works/' + workID + '/alignment-jobs')
    ).json();
    const job = jobs.find((item: { alignment_id?: string }) => item.alignment_id);
    const alignment = await (
      await first.request.get(testServer + '/api/v1/alignments/' + job.alignment_id)
    ).json();
    const segment = alignment.segments.filter(
      (item: { highlightable: boolean; text: string }) =>
        item.highlightable && item.text.length > 30,
    )[20];
    const previous = await first.request.get(progressURL);
    const revision = previous.status() === 404 ? 0 : (await previous.json()).revision;
    const seeded = await first.request.put(progressURL, {
      data: {
        alignment_id: job.alignment_id,
        segment_id: segment.id,
        offset: 500000,
        expected_revision: revision,
        source_device: 'handoff-test',
      },
    });
    expect(seeded.ok()).toBe(true);
    let exactPlace = await seeded.json();
    const normalizedText = segment.text.replace(/\s+/gu, ' ').trim();
    const points = Array.from(normalizedText) as string[];
    let start = Math.round(points.length / 2);
    while (points[start] === ' ') start++;
    let expectedHighlight = points.slice(start).join('').split(' ')[0];
    async function expectExactHighlight(page: import('@playwright/test').Page) {
      await expect
        .poll(async () => {
          const highlights = await Promise.all(
            page
              .frames()
              .map((frame) =>
                frame.evaluate(() => window.getSelection()?.toString() ?? '').catch(() => ''),
              ),
          );
          return highlights.some((text) => text.replace(/\s+/gu, ' ').trim() === expectedHighlight);
        })
        .toBe(true);
    }

    await first.goto(consume);
    const initialPrompt = first.getByRole('button', { name: 'Continue here', exact: true });
    // The fixture server is shared between tests; explicitly accept any prior owner.
    await expect(first.getByRole('button', { name: 'Next page' }).or(initialPrompt)).toBeVisible({
      timeout: 30000,
    });
    if (await initialPrompt.isVisible()) await initialPrompt.click();
    await expect(first.getByRole('button', { name: 'Next page' })).toBeEnabled({ timeout: 30000 });
    await expectExactHighlight(first);
    // Save a real multiword selection through the production reader and API.
    const rangeSaved = first.waitForResponse((response) => {
      if (response.request().method() !== 'PUT' || !response.url().endsWith('/state')) return false;
      return Boolean(
        response.request().postDataJSON()?.epub_locator?.resume_selection?.progress?.revision,
      );
    });
    for (const frame of first.frames()) {
      const selected = await frame
        .evaluate((text) => {
          const paragraph = [...document.querySelectorAll('p')].find((p) =>
            p.textContent?.replace(/\s+/gu, ' ').trim().includes(text.replace(/\s+/gu, ' ').trim()),
          );
          if (!paragraph) return null;
          const range = document.createRange();
          const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
          const nodes: Text[] = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode())
            nodes.push(node as Text);
          const start = nodes.find((node) => node.data.trim())!;
          range.setStart(start, start.data.search(/\S/u));
          range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length);
          const selection = document.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return range.toString().replace(/\s+/gu, ' ').trim();
        }, segment.text)
        .catch(() => null);
      if (selected) {
        expectedHighlight = selected;
        break;
      }
    }
    expect(expectedHighlight.length).toBeGreaterThan(30);
    expect((await rangeSaved).ok()).toBe(true);
    exactPlace = await (await first.request.get(progressURL)).json();
    const firstOwner = await (
      await first.request.get(testServer + '/api/v1/works/' + workID + '/reading-session')
    ).json();

    await signInAsTestAdmin(second);
    await second.goto(consume);
    await expect(second.getByRole('button', { name: 'Continue here', exact: true })).toBeVisible();
    await expect(second.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    const claimResponse = second.waitForResponse((response) =>
      response.url().endsWith('/reading-session/claim'),
    );
    await second.getByRole('button', { name: 'Continue here', exact: true }).click();
    const captured = await (await claimResponse).json();
    expect(captured.progress).toEqual(exactPlace);
    expect(captured.owner.epoch).toBe(firstOwner.epoch + 1);
    await expect(second.getByRole('button', { name: 'Next page' })).toBeEnabled({ timeout: 30000 });
    await expect(second.getByRole('dialog')).toHaveCount(0);
    await expectExactHighlight(second);
    await second.reload();
    await expect(second.getByRole('button', { name: 'Next page' })).toBeEnabled({ timeout: 30000 });
    await expectExactHighlight(second);
    expect(await (await second.request.get(progressURL)).json()).toEqual(exactPlace);
    await expect(first.getByRole('button', { name: 'Resume here', exact: true })).toBeVisible({
      timeout: 25000,
    });

    const owner = await (
      await first.request.get(testServer + '/api/v1/works/' + workID + '/reading-session')
    ).json();
    await expect(first.getByRole('alert').filter({ hasText: 'Continued on' })).toHaveAttribute(
      'aria-live',
      'assertive',
    );
    expect(owner.epoch).toBe(captured.owner.epoch + 1);
    expect(owner.device_id).toBe(captured.owner.device_id);
    expect(await (await first.request.get(progressURL)).json()).toEqual(exactPlace);
    await expect(first.getByRole('button', { name: 'Switch to listening' })).toHaveCount(0);
    await expect(first.getByRole('dialog')).toHaveCount(0);
    expect(owner.device_id).not.toBe(firstOwner.device_id);
    const stale = await first.request.post(
      testServer + '/api/v1/works/' + workID + '/reading-session/heartbeat',
      {
        data: { device_id: firstOwner.device_id, epoch: firstOwner.epoch },
      },
    );
    expect(stale.status()).toBe(409);

    await first.getByRole('button', { name: 'Resume here', exact: true }).click();
    await expect(first.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
    // Returning to the original client must preserve both ends, not just its saved start.
    await expectExactHighlight(first);
    await expect(second.getByRole('button', { name: 'Resume here', exact: true })).toBeVisible({
      timeout: 25000,
    });
    // Repeat the round trip without making a new selection: restoring alone
    // must neither shorten the range nor move its canonical starting point.
    for (const [active, previous] of [
      [second, first],
      [first, second],
    ]) {
      await active.getByRole('button', { name: 'Resume here', exact: true }).click();
      await expect(active.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
      await expectExactHighlight(active);
      expect(await (await active.request.get(progressURL)).json()).toEqual(exactPlace);
      await expect(previous.getByRole('button', { name: 'Resume here', exact: true })).toBeVisible({
        timeout: 25000,
      });
    }
    const exitWrites: string[] = [];
    second.on('request', (request) => {
      if (request.method() === 'PUT' && /\/(progress|state)$/.test(request.url()))
        exitWrites.push(request.url());
    });
    await second.getByRole('button', { name: 'Back to work', exact: true }).click();
    await expect(second).not.toHaveURL(/\/consume\//);
    expect(exitWrites).toEqual([]);
    expect(await (await first.request.get(progressURL)).json()).toEqual(exactPlace);
    const resolve = first.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/resolve/epub'),
    );
    await first.getByRole('button', { name: 'Switch to listening' }).click();
    const restoredCursor = (await resolve).postDataJSON();
    expect(restoredCursor.offset).toBe(exactPlace.offset);
    expect(restoredCursor.locator.segment_id).toBe(exactPlace.segment_id);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test('a missing ownership endpoint cannot silently enable reading', async ({ page }) => {
  await signInAsTestAdmin(page);
  await page.route('**/reading-session', (route) =>
    route.fulfill({ status: 404, body: 'not found' }),
  );
  await page.goto(consume);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
});

test('a failed EPUB load keeps takeover pending and retries restoration without another claim', async ({
  page,
}) => {
  await signInAsTestAdmin(page);
  let claims = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/reading-session/claim')) claims++;
  });
  await page.route('**/api/v1/media/alice-gutenberg-11-epub-media', (route) =>
    route.fulfill({ status: 500, body: 'failed' }),
  );
  await page.goto(consume);
  await page.getByRole('button', { name: 'Continue here', exact: true }).click();
  await expect(
    page.getByText('This device is active, but your place didn’t open', { exact: true }),
  ).toBeVisible();
  expect(claims).toBe(1);
  await page.unroute('**/api/v1/media/alice-gutenberg-11-epub-media');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled();
  expect(claims).toBe(1);
});

test('a changed server place requires an explicit choice and handles another revision change', async ({
  page,
}) => {
  await signInAsTestAdmin(page);
  await page.goto(consume);
  await page.getByRole('button', { name: 'Continue here', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled({ timeout: 30000 });
  const progressURL = testServer + '/api/v1/works/' + workID + '/progress';
  const original = await (await page.request.get(progressURL)).json();
  async function moveServer(offset: number) {
    const latest = await (await page.request.get(progressURL)).json();
    const response = await page.request.put(progressURL, {
      data: {
        alignment_id: latest.alignment_id,
        segment_id: latest.segment_id,
        offset,
        expected_revision: latest.revision,
        source_device: 'koreader',
      },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  const remote = await moveServer(original.offset + 100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const confirm = page.getByRole('button', { name: 'Continue from selected place', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeDisabled();
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(confirm).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`place-choice-${width}.png`),
      animations: 'disabled',
    });
  }

  await page.getByRole('button', { name: 'Decide later', exact: true }).click();
  await expect(
    page.getByText('Both places are kept. Saving is paused until you choose.'),
  ).toBeVisible();
  expect(await (await page.request.get(progressURL)).json()).toEqual(remote);
  await page.reload();
  await expect(confirm).toBeVisible({ timeout: 30000 });
  await expect(confirm).toBeDisabled();
  expect(await (await page.request.get(progressURL)).json()).toEqual(remote);
  await page.getByRole('radio', { name: /^This device\./ }).click();
  const changedAgain = await moveServer(original.offset + 200);
  await confirm.click();
  await expect(confirm).toBeDisabled();
  expect(await (await page.request.get(progressURL)).json()).toEqual(changedAgain);
  await page.getByRole('radio', { name: /^This device\./ }).click();
  await confirm.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const chosen = await (await page.request.get(progressURL)).json();
  expect(chosen.segment_id).toBe(original.segment_id);
  expect(chosen.offset).toBe(original.offset);
  expect(chosen.revision).toBe(changedAgain.revision + 1);
  const serverChoice = await moveServer(original.offset + 300);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(confirm).toBeVisible();
  await page.getByRole('radio', { name: /^Your server\./ }).click();
  await confirm.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await (await page.request.get(progressURL)).json()).toEqual(serverChoice);
});

async function claimFixture(page: import('@playwright/test').Page, device: string) {
  const url = testServer + '/api/v1/works/' + workID + '/reading-session';
  const current = await (await page.request.get(url)).json();
  const claimed = await page.request.post(url + '/claim', {
    data: {
      device_id: device,
      label: device,
      platform: 'web',
      request_id: device + '-' + (current?.epoch ?? 0),
      expected_epoch: current?.epoch ?? 0,
    },
  });
  expect(claimed.ok()).toBe(true);
  return (await claimed.json()).owner;
}

test('book details and Not now never take ownership', async ({ page }) => {
  await signInAsTestAdmin(page);
  const before = await claimFixture(page, 'Details test device');
  await page.goto('/work/' + workID);
  await expect(page.getByText(/Reading on Details test device/)).toBeVisible();
  const url = testServer + '/api/v1/works/' + workID + '/reading-session';
  expect(await (await page.request.get(url)).json()).toMatchObject({
    epoch: before.epoch,
    device_id: before.device_id,
  });
  await page.goto(consume);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/work/' + workID + '$'));
  expect(await (await page.request.get(url)).json()).toMatchObject({
    epoch: before.epoch,
    device_id: before.device_id,
  });
});

test('a refused takeover keeps the owner and can be retried', async ({ page }) => {
  await signInAsTestAdmin(page);
  const before = await claimFixture(page, 'Transfer test device');
  await page.route('**/reading-session/claim', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto(consume);
  await page.getByRole('button', { name: 'Continue here', exact: true }).click();
  await expect(page.getByText('Couldn’t move your place here', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
  const url = testServer + '/api/v1/works/' + workID + '/reading-session';
  expect(await (await page.request.get(url)).json()).toMatchObject({
    epoch: before.epoch,
    device_id: before.device_id,
  });
  await page.unroute('**/reading-session/claim');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled({ timeout: 30000 });
  expect((await (await page.request.get(url)).json()).epoch).toBe(before.epoch + 1);
});

test('canceling a delayed accepted claim never rolls ownership back or opens the reader', async ({
  page,
}) => {
  await signInAsTestAdmin(page);
  const before = await claimFixture(page, 'Delayed test device');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let accepted!: () => void;
  const reached = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route('**/reading-session/claim', async (route) => {
    const response = await route.fetch();
    accepted();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(consume);
    await page.getByRole('button', { name: 'Continue here', exact: true }).click();
    await reached;
    await expect(page.getByText('Moving your place here…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Moving your place here…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continue here', exact: true })).toBeVisible();
    release();
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    const owner = await (
      await page.request.get(testServer + '/api/v1/works/' + workID + '/reading-session')
    ).json();
    expect(owner.epoch).toBe(before.epoch + 1);
    expect(owner.device_id).not.toBe(before.device_id);
  } finally {
    release();
  }
});

test('an offline browser keeps its place and offers a choice after another device takes over', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await signInAsTestAdmin(page);
  await page.goto(consume);
  const takeover = page.getByRole('button', { name: 'Continue here', exact: true });
  await expect(takeover.or(page.getByRole('button', { name: 'Next page' }))).toBeVisible({
    timeout: 30000,
  });
  if (await takeover.isVisible()) await takeover.click();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  await page.getByRole('button', { name: 'CHAPTER I. Down the Rabbit-Hole' }).click();
  await expect(page.getByText('Reading place saved', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(
    page.getByText('Saved on this device · Waiting to upload', { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const queued = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.includes('outbox:')),
  );
  expect(
    queued.some(
      ([, value]) => value.includes('expected_revision') || value.includes('epub_locator'),
    ),
  ).toBe(true);
  // APIRequestContext remains available while this browser surface is offline.
  await claimFixture(page, 'other-offline-test-device');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Resume here', exact: true })).toBeVisible({
    timeout: 25000,
  });
  await page.getByRole('button', { name: 'Resume here', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Continue from selected place', exact: true });
  await expect(confirm).toBeVisible({ timeout: 30000 });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Decide later', exact: true }).click();
  const retained = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.includes('outbox:')),
  );
  expect(retained.length).toBeGreaterThan(0);
});
