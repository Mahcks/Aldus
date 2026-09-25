import { expect, test } from '@playwright/test';
import { signInAsTestAdmin } from './auth';

for (const viewport of [{ width: 390, height: 500 }, { width: 740, height: 390 }]) {
  test(`mobile menu keeps all destinations reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signInAsTestAdmin(page);
    await page.goto('/home');
    const more = page.getByRole('tab', { name: 'More', exact: true });
    await more.click();
    const menu = page.getByRole('dialog', { name: 'More', exact: true });
    const bounds = await menu.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    const system = menu.getByRole('link', { name: 'System', exact: true });
    await system.scrollIntoViewIfNeeded();
    await system.click();
    await expect(page).toHaveURL(/\/system$/);
    await more.click();
    await expect(menu.getByRole('button', { name: 'Sign out', exact: true })).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
