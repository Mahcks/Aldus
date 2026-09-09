import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

for (const width of [390, 1024, 1440]) {
  for (const keepDevice of [false, true]) {
    test(`edition conflict keeps ${keepDevice ? 'device' : 'server'} place at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await signInAsTestAdmin(page);
      const workPath = '**/works/alice-gutenberg-11-work';
      await page.route(`${workPath}/alignment-jobs`, (route) => route.fulfill({ json: [] }));
      await page.route(`${workPath}/progress`, (route) => route.fulfill({ json: null }));
      await page.route(`${workPath}/preference`, (route) => route.fulfill({ json: null }));
      let revision = 1;
      let remoteTimestamp = 0;
      let conflictArmed = false;
      let failedUpdate: Record<string, unknown> | undefined;
      const updates: Record<string, unknown>[] = [];
      await page.route('**/representations/*/state', async (route) => {
        const representationID = new URL(route.request().url()).pathname.split('/').at(-2)!;
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON();
          updates.push(body);
          if (conflictArmed && body.expected_revision !== revision) {
            failedUpdate = body;
            await route.fulfill({ status: 409, json: { error: 'conflict' } });
            return;
          }
          remoteTimestamp = body.audio_timestamp_ms ?? remoteTimestamp;
          revision++;
        }
        await route.fulfill({
          json: {
            representation_id: representationID,
            revision,
            audio_timestamp_ms: remoteTimestamp,
            playback_speed: 1,
            updated_at: '2026-09-09T12:00:00Z',
          },
        });
      });
      await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
      const forward = page.getByRole('button', { name: 'Skip forward 15 seconds', exact: true });
      await expect(forward).toBeEnabled({ timeout: 30000 });
      await expect.poll(() => updates.length).toBeGreaterThan(0);
      remoteTimestamp = 60000;
      revision += 10;
      conflictArmed = true;
      await forward.click();
      const serverChoice = page.getByRole('button', {
        name: "Use server's saved place",
        exact: true,
      });
      const deviceChoice = page.getByRole('button', {
        name: "Keep this device's place",
        exact: true,
      });
      await expect(serverChoice).toBeVisible();
      await expect(deviceChoice).toBeVisible();
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.audio_timestamp_ms).toBeGreaterThan(0);
      const attemptsAtConflict = updates.length;
      await forward.click();
      await page.screenshot({
        path: `../artifacts/edition-conflict/${width}-${keepDevice ? 'device' : 'server'}.png`,
      });
      expect(updates).toHaveLength(attemptsAtConflict);
      expect(remoteTimestamp).toBe(60000);
      if (keepDevice) {
        const expectedRevision = revision;
        await deviceChoice.click();
        await expect(deviceChoice).toHaveCount(0);
        expect(updates.at(-1)?.expected_revision).toBe(expectedRevision);
        expect(remoteTimestamp).toBe(failedUpdate?.audio_timestamp_ms);
        await expect(page.getByText('0:15', { exact: true })).toBeVisible();
      } else {
        await serverChoice.click();
        await expect(serverChoice).toHaveCount(0);
        expect(updates).toHaveLength(attemptsAtConflict);
        expect(remoteTimestamp).toBe(60000);
        await expect(page.getByText('1:00', { exact: true })).toBeVisible();
      }
    });
  }
}
