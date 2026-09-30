import { expect, test } from '@playwright/test';
import { continueReadingHere, signInAsTestAdmin, testServer } from './auth';

test('Listen restores the saved time before showing the player and reuses loaded audio', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await signInAsTestAdmin(page);
  const work = `${testServer}/api/v1/works/alice-gutenberg-11-work`;
  const jobs = await (await page.request.get(`${work}/alignment-jobs`)).json();
  const job = jobs.find((item: { alignment_id?: string }) => item.alignment_id);
  const alignment = await (
    await page.request.get(`${testServer}/api/v1/alignments/${job.alignment_id}`)
  ).json();
  const segment = alignment.segments.filter(
    (s: { highlightable: boolean; text: string }) => s.highlightable && s.text.length > 60,
  )[30];
  const old = await page.request.get(`${work}/progress`);
  const revision = old.status() === 404 ? 0 : (await old.json()).revision;
  expect(
    (
      await page.request.put(`${work}/progress`, {
        data: {
          alignment_id: job.alignment_id,
          segment_id: segment.id,
          offset: 500000,
          expected_revision: revision,
          source_device: 'startup-test',
        },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    const state = { media: [] as HTMLAudioElement[] };
    (window as any).startup = state;
    window.Audio = new Proxy(window.Audio, {
      construct(Target, args) {
        const media = new Target(...args);
        state.media.push(media);
        return media;
      },
    });
  });
  let releaseAudio!: () => void;
  const audioGate = new Promise<void>((resolve) => {
    releaseAudio = resolve;
  });
  await page.route(`${testServer}/api/v1/media/${job.audio_media_id}`, async (route) => {
    await audioGate;
    await route.continue();
  });
  await page.goto('/consume/alice-gutenberg-11-work?mode=read');
  await continueReadingHere(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(page.getByRole('button', { name: 'Listen from here', exact: true })).toBeEnabled();
    const started = Date.now();
    await page.getByRole('button', { name: 'Listen from here', exact: true }).click();
    if (attempt === 0) {
      await expect(page.getByLabel('Opening your listening place…', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Read along text', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: testInfo.outputPath(`loading-${width}.png`) });
      }
      releaseAudio();
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).startup.media.some(
            (m: HTMLAudioElement) => !m.paused && m.readyState >= 3 && m.currentTime > 10,
          ),
        ),
      )
      .toBe(true);
    console.log('Listen ready (ms)', attempt, Date.now() - started);
    expect(
      await page.evaluate(
        () => (window as any).startup.media.filter((m: HTMLAudioElement) => m.src).length,
      ),
    ).toBe(1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to reading', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Back to work', exact: true }).click();
  await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
  await continueReadingHere(page, 'listen');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByLabel('Read along text', { exact: true })).toBeVisible();
});
