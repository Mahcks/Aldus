import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';
import { readAlongChunks } from '../src/lib/consumption/read-along';
import type { AlignmentSegment } from '../src/generated/api';

for (const exact of [true, false]) {
  for (const width of [390, 1024, 1440]) {
    test(`timed narration advances in small chunks at ${width}px, exact=${exact}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await signInAsTestAdmin(page);
      await page.route('**/works/alice-gutenberg-11-work/progress', (route) =>
        route.fulfill({ json: null }),
      );
      await page.route('**/representations/*/state', (route) => route.fulfill({ json: null }));
      const text =
        'Alice walked through the garden and listened carefully to the curious story as the afternoon sunlight fell across the path and the flowers swayed gently beside her in the breeze. She stopped to ask another question before continuing on her way.';
      const words = text.split(' ');
      const segment = {
        id: 'read-along-test',
        text,
        audio_start_ms: 0,
        audio_end_ms: words.length * 1000,
        highlightable: true,
        word_timings: words.map((word, index) => ({
          text: word,
          startTime: index,
          endTime: index + 0.8,
        })),
      } as AlignmentSegment;
      if (!exact) segment.word_timings = (segment.word_timings as unknown[]).slice(1);
      const chunks = readAlongChunks(segment);
      await page.route('**/api/v1/alignments/*', async (route) => {
        const response = await route.fetch();
        const alignment = await response.json();
        await route.fulfill({
          json: { ...alignment, segments: [{ ...alignment.segments[0], ...segment }] },
        });
      });
      await page.addInitScript(() => {
        const OriginalAudio = window.Audio;
        window.Audio = class extends OriginalAudio {
          constructor(src?: string) {
            super(src);
            if (src) (window as unknown as { testAudio: HTMLMediaElement }).testAudio = this;
          }
        };
      });
      await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({
        timeout: 30_000,
      });
      const panel = page.getByLabel('Read along text', { exact: true });
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean((window as unknown as { testAudio?: HTMLMediaElement }).testAudio),
          ),
        )
        .toBe(true);
      async function seek(timestamp: number) {
        await page.evaluate((time) => {
          const audio = (window as unknown as { testAudio: HTMLMediaElement }).testAudio;
          audio.currentTime = time;
          audio.dispatchEvent(new Event('seeked'));
        }, timestamp);
      }
      // Every phrase stays on the page as context; only the one being narrated is selected.
      const phrase = (index: number) =>
        panel.getByRole('button', { name: chunks[index].text, exact: true });
      await seek(0);
      await expect(phrase(0)).toHaveAttribute('aria-selected', 'true');
      await seek(chunks[1].startMS / 1000 + 1);
      await expect(phrase(1)).toHaveAttribute('aria-selected', 'true');
      await expect(phrase(0)).toHaveAttribute('aria-selected', 'false');
      await expect(phrase(1)).toBeInViewport();
      await expect(page.getByRole('alert')).toHaveCount(0);
      // The label stays steady whichever kind of timing a phrase has.
      await expect(page.getByText(/approximate timing/)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('read-along.png'), fullPage: true });
      await seek(0);
      await expect(phrase(0)).toHaveAttribute('aria-selected', 'true');
      // Tapping a phrase seeks the narration there, like the scrubber does.
      const target = chunks[chunks.length - 1];
      await phrase(chunks.length - 1).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.currentTime,
          ),
        )
        .toBeCloseTo(target.startMS / 1000, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    });
  }
}
