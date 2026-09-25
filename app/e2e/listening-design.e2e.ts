import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

for (const width of [390, 1024, 1440]) {
  test(`listening keeps text and the header mode switch available at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAsTestAdmin(page);
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime',
      )!;
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        ...descriptor,
        set(value: number) {
          (window as unknown as { testAudio: HTMLMediaElement }).testAudio = this;
          const state = window as unknown as { testSeekCount?: number };
          state.testSeekCount = (state.testSeekCount ?? 0) + 1;
          descriptor.set!.call(this, value);
        },
      });
    });
    await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled({ timeout: 30_000 });
    const text = page.getByLabel('Read along text', { exact: true });
    await expect(text).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cover', exact: true })).toHaveCount(0);
    const readAlong = page.getByRole('button', { name: 'Read along', exact: true });
    await expect(readAlong).toHaveAttribute('aria-pressed', 'true');
    // Turning it off gives the cover back; turning it on restores the text.
    await readAlong.click();
    await expect(text).toHaveCount(0);
    await expect(readAlong).toHaveAttribute('aria-pressed', 'false');
    await readAlong.click();
    await expect(text).toBeVisible();
    const switchMode = page.getByRole('button', { name: 'Switch to reading', exact: true });
    await expect(switchMode).toHaveCount(1);
    const switchBounds = await switchMode.boundingBox();
    expect(switchBounds!.y).toBeLessThan(70);
    const track = page.getByLabel('Audiobook position', { exact: true });
    const bounds = await track.boundingBox();
    expect(bounds).not.toBeNull();
    // Dragging previews locally; the media player seeks only on release.
    const audio = () =>
      page.evaluate(
        () => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.currentTime,
      );
    const seekCount = () =>
      page.evaluate(() => (window as unknown as { testSeekCount: number }).testSeekCount);
    const initialSeeks = await seekCount();
    const beforeDrag = await audio();
    const startX = bounds!.x + bounds!.width * 0.2;
    const centerY = bounds!.y + 22;
    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await expect(page.getByTestId('audio-player-scroll')).toHaveCSS('overflow-y', 'hidden');
    await expect(text).toHaveCSS('overflow-y', 'hidden');
    await page.mouse.move(startX + bounds!.width * 0.2, centerY, { steps: 15 });
    const coarse = Number(await track.getAttribute('aria-valuenow'));
    expect(await audio()).toBeCloseTo(beforeDrag, 1);
    await page.mouse.move(startX + bounds!.width * 0.2, centerY - 130);
    await expect(page.getByText('Fine scrubbing · 1/20 speed', { exact: true })).toBeVisible();
    await page.mouse.move(startX + bounds!.width * 0.4, centerY - 130, { steps: 15 });
    const fine = Number(await track.getAttribute('aria-valuenow'));
    const duration = Number(await track.getAttribute('aria-valuemax'));
    expect(fine - coarse).toBeCloseTo(duration * 0.01, -1);
    expect(await audio()).toBeCloseTo(beforeDrag, 1);
    expect(await seekCount()).toBe(initialSeeks);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await page.screenshot({ path: testInfo.outputPath('fine-scrubbing.png') });
    await page.mouse.up();
    await expect(page.getByTestId('audio-player-scroll')).toHaveCSS('overflow-y', 'auto');
    await expect(text).toHaveCSS('overflow-y', 'auto');
    await expect.poll(audio).toBeCloseTo(fine, 0);
    await expect(track).not.toHaveAttribute('aria-disabled', 'true');
    expect(await seekCount()).toBe(initialSeeks + 1);
    await track.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(audio).toBeCloseTo(fine + 5, 0);
    await expect(track).not.toHaveAttribute('aria-disabled', 'true');
    await track.click({ position: { x: 0, y: 22 } });
    await expect(text).toContainText('CHAPTER I.');
    await track.click({ position: { x: bounds!.width * 0.12, y: 22 } });
    await play.click();
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pause).toBeVisible();
    await expect(page.getByText('Following the narration')).toHaveCount(0);
    await expect(page).toHaveURL(/mode=listen/);
    await pause.click();
    await expect(play).toBeVisible();
    const playBounds = await play.boundingBox();
    expect(playBounds!.y + playBounds!.height).toBeGreaterThan(800);
    expect(playBounds!.y + playBounds!.height).toBeLessThanOrEqual(880);
    const textBounds = await text.boundingBox();
    const trackBounds = await track.boundingBox();
    // Play stays centred under the scrubber whatever else sits in the row.
    expect(
      Math.abs(playBounds!.x + playBounds!.width / 2 - (trackBounds!.x + trackBounds!.width / 2)),
    ).toBeLessThan(2);
    expect(textBounds!.y + textBounds!.height).toBeLessThanOrEqual(trackBounds!.y);
    await expect(
      page.getByText("Alice's Adventures in Wonderland", { exact: true }).last(),
    ).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('listening.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    if (width === 390) {
      await page.setViewportSize({ width, height: 540 });
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('short-screen.png'), fullPage: true });
    }
    await switchMode.click();
    await expect(page.getByRole('button', { name: 'Open reader settings' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(pause).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Switch to listening', exact: true }),
    ).toBeVisible();
  });
}

for (const width of [390, 1024, 1440]) {
  test(`standalone audiobook artwork and controls fit at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAsTestAdmin(page);
    await page.route('**/works/alice-gutenberg-11-work/representations', async (route) => {
      const response = await route.fetch();
      const editions = await response.json();
      await route.fulfill({
        json: editions.filter((edition: { kind: string }) => edition.kind !== 'epub'),
      });
    });
    await page.route('**/works/alice-gutenberg-11-work/alignment-jobs', (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/works/alice-gutenberg-11-work/progress', (route) =>
      route.fulfill({ json: null }),
    );
    await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByLabel('Read along text', { exact: true })).toHaveCount(0);
    // No standing warning; the reason appears only when Read along is pressed.
    await expect(page.getByText('Read along needs a synced book')).toHaveCount(0);
    await page.getByRole('button', { name: 'Read along', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: 'Read along needs a synced book' });
    await expect(prompt.getByText(/needs an ebook as well as this audiobook/)).toBeVisible();
    await prompt.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Switch to reading', exact: true })).toHaveCount(
      0,
    );
    const artwork = page
      .getByTestId('audio-player-scroll')
      .getByLabel("Cover for Alice's Adventures in Wonderland", { exact: true });
    // The frame matches the artwork's own shape, so nothing is trimmed off it.
    const image = artwork.locator('img');
    await expect(image).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await artwork.boundingBox();
        const natural = await image.evaluate(
          (element) =>
            (element as HTMLImageElement).naturalWidth /
            (element as HTMLImageElement).naturalHeight,
        );
        return Math.abs(bounds!.width / bounds!.height - natural);
      })
      .toBeLessThan(0.03);
    await expect(artwork).toBeInViewport();
    await expect(play).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('standalone.png'), fullPage: true });
    await play.click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });
}

for (const width of [390, 1024, 1440]) {
  test(`portrait audiobook art is shown whole, not cropped, at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAsTestAdmin(page);
    // A tall book jacket, as many audiobooks ship: it must not be trimmed into a square.
    const jacket =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#3b1a5a"/><text x="100" y="40" text-anchor="middle" fill="#f7d878" font-size="26">TITLE</text><text x="100" y="280" text-anchor="middle" fill="#f7d878" font-size="14">AUTHOR</text></svg>';
    await page.route(
      (url) =>
        /\/(media|works)\/[^/]+\/cover/.test(url.pathname) || url.pathname.endsWith('/cover'),
      (route) => route.fulfill({ contentType: 'image/svg+xml', body: jacket }),
    );
    await page.route('**/works/alice-gutenberg-11-work/representations', async (route) => {
      const response = await route.fetch();
      const editions = await response.json();
      await route.fulfill({
        json: editions.filter((edition: { kind: string }) => edition.kind !== 'epub'),
      });
    });
    await page.route('**/works/alice-gutenberg-11-work/alignment-jobs', (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/works/alice-gutenberg-11-work/progress', (route) =>
      route.fulfill({ json: null }),
    );
    await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    const artwork = page
      .getByTestId('audio-player-scroll')
      .getByLabel("Cover for Alice's Adventures in Wonderland", { exact: true });
    await expect(artwork).toBeInViewport();
    await expect
      .poll(async () => {
        const bounds = await artwork.boundingBox();
        return bounds ? bounds.width / bounds.height : 0;
      })
      .toBeCloseTo(2 / 3, 1);
    // Big enough to matter: tall, and centred under the header.
    const bounds = await artwork.boundingBox();
    expect(bounds!.height).toBeGreaterThan(250);
    await page.screenshot({ path: testInfo.outputPath('portrait-art.png') });
  });
}
