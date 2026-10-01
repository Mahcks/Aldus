import { expect, test } from '@playwright/test';
import { continueReadingHere, signInAsTestAdmin } from './auth';

// expo-audio's web <audio> element is never attached to the page, so record
// every volume the app sets on any media element instead.
const recordVolumes = () => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')!;
  const seen: number[] = [];
  (window as unknown as { volumes: number[] }).volumes = seen;
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    get() {
      return descriptor.get!.call(this);
    },
    set(value: number) {
      seen.push(value);
      descriptor.set!.call(this, value);
    },
  });
};

test('web listeners can set and mute the audiobook volume', async ({ page }) => {
  // Opens the player twice (before and after a reload), each with a real session claim.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(recordVolumes);
  await signInAsTestAdmin(page);
  await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
  await continueReadingHere(page).catch(() => {});

  const volumeButton = page.getByRole('button', { name: 'Volume, 100%', exact: true });
  await expect(volumeButton).toBeEnabled({ timeout: 30000 });
  await volumeButton.click();
  const panel = page.getByRole('dialog', { name: 'Volume', exact: true });
  const slider = panel.getByRole('slider', { name: 'Volume', exact: true });
  await expect(slider).toBeFocused();
  for (let step = 0; step < 14; step++) await page.keyboard.press('ArrowLeft');
  await expect(panel.getByText('30%', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { volumes: number[] }).volumes.at(-1)))
    .toBeCloseTo(0.3);
  await page.screenshot({ path: '../artifacts/player-volume/1440-open.png' });

  await panel.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(panel.getByText('Muted', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { volumes: number[] }).volumes.at(-1)))
    .toBe(0);
  await panel.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect(panel.getByText('30%', { exact: true })).toBeVisible();

  // Escape closes the panel and keeps the chosen level; it is remembered on reload.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Volume, 30%', exact: true })).toBeFocused();
  await page.reload();
  await continueReadingHere(page).catch(() => {});
  await expect(page.getByRole('button', { name: 'Volume, 30%', exact: true })).toBeVisible({
    timeout: 30000,
  });
});

test('phones use the device volume instead of an in-app control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsTestAdmin(page);
  await page.goto('/consume/alice-gutenberg-11-work?mode=listen');
  await continueReadingHere(page).catch(() => {});
  await expect(page.getByRole('button', { name: 'Set sleep timer', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: /^Volume/ })).toHaveCount(0);
});
