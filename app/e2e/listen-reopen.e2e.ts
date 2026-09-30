import { expect, test } from '@playwright/test';
import { readAlongChunks, readAlongChunkIndex } from '../src/lib/consumption/read-along';
import { continueReadingHere, signInAsTestAdmin, testServer } from './auth';

for (const reopen of [true, false]) {
  test(`listening then ${reopen ? 'reopening' : 'switching to reading'} restores the passage without changing the saved place`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    await signInAsTestAdmin(page);
    const work = `${testServer}/api/v1/works/alice-gutenberg-11-work`;
    const jobs = await (await page.request.get(`${work}/alignment-jobs`)).json();
    const job = jobs.find((item: { alignment_id?: string }) => item.alignment_id);
    const alignmentURL = `${testServer}/api/v1/alignments/${job.alignment_id}`;
    const alignment = await (await page.request.get(alignmentURL)).json();
    const segments = alignment.segments.filter(
      (s: { highlightable: boolean; text: string }) => s.highlightable && s.text.length > 60,
    );
    const old = await page.request.get(`${work}/progress`);
    const revision = old.status() === 404 ? 0 : (await old.json()).revision;
    expect(
      (
        await page.request.put(`${work}/progress`, {
          data: {
            alignment_id: job.alignment_id,
            segment_id: segments[10].id,
            offset: 0,
            expected_revision: revision,
            source_device: 'reopen-test',
          },
        })
      ).ok(),
    ).toBe(true);
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime',
      )!;
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        ...descriptor,
        set(value: number) {
          (window as unknown as { testAudio: HTMLMediaElement }).testAudio = this;
          descriptor.set!.call(this, value);
        },
      });
    });
    await page.goto('/consume/alice-gutenberg-11-work?mode=read');
    await continueReadingHere(page);
    await expect(page.getByRole('button', { name: 'Listen from here', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Switch to listening', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const timestamp = segments[30].audio_start_ms + 1500;
    await page.evaluate((ms) => {
      const audio = (window as unknown as { testAudio: HTMLMediaElement }).testAudio;
      audio.pause();
      audio.currentTime = ms / 1000;
    }, timestamp);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.seeking,
        ),
      )
      .toBe(false);
    const expected = await (
      await page.request.post(`${alignmentURL}/resolve/audio`, {
        data: {
          resource: segments[30].audio_resource,
          timestamp_ms: timestamp,
        },
      })
    ).json();
    if (reopen) {
      await page.getByRole('button', { name: 'Back to work', exact: true }).click();
      await expect(page).not.toHaveURL(/\/consume\//);
    } else {
      await page.getByRole('button', { name: 'Switch to reading', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Listen from here', exact: true }),
      ).toBeEnabled();
    }
    const saved = await (await page.request.get(`${work}/progress`)).json();
    expect(saved).toMatchObject({ segment_id: expected.segment_id, offset: expected.offset });
    const writes: unknown[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && /\/(progress|state)$/.test(request.url()))
        writes.push(request.postDataJSON());
    });
    if (reopen) {
      await page.getByRole('button', { name: /^(Start reading|Continue reading|Read)$/ }).click();
      await continueReadingHere(page);
    }
    await expect(page.getByRole('button', { name: 'Listen from here', exact: true })).toBeEnabled();
    const targetSegment = alignment.segments.find(
      (s: { id: string }) => s.id === expected.segment_id,
    );
    const normalized = targetSegment.text.replace(/\s+/gu, ' ').trim();
    const chunks = readAlongChunks(targetSegment);
    const expectedPassage = chunks[readAlongChunkIndex(chunks, timestamp)].text;
    await expect
      .poll(async () => {
        const selections = await Promise.all(
          page.frames().map((frame) =>
            frame
              .evaluate(() => {
                const selection = document.getSelection();
                return {
                  text: selection?.toString().replace(/\s+/gu, ' ').trim(),
                  paragraph: selection?.anchorNode?.parentElement
                    ?.closest('p')
                    ?.textContent?.replace(/\s+/gu, ' ')
                    .trim(),
                };
              })
              .catch(() => ({ text: '', paragraph: '' })),
          ),
        );
        return selections.some(
          (selection) =>
            selection.text === expectedPassage && selection.paragraph?.includes(normalized),
        );
      })
      .toBe(true);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: testInfo.outputPath(`resume-${width}.png`) });
    }
    for (const frame of page.frames()) {
      await frame.evaluate(() => {
        if (!document.getSelection()?.isCollapsed)
          document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
      });
    }
    await page.clock.install();
    await page.clock.runFor(1500);
    expect(writes).toEqual([]);
    expect(await (await page.request.get(`${work}/progress`)).json()).toEqual(saved);
    await page.getByRole('button', { name: 'Back to work', exact: true }).click();
    await expect(page).not.toHaveURL(/\/consume\//);
    expect(writes).toEqual([]);
  });
}
