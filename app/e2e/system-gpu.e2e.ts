import { expect, test } from '@playwright/test';
import type { AlignmentGpuStatus } from '../src/generated/api';

for (const width of [390, 1024, 1440]) {
  test(`System uses real diagnostic results at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const unchecked: AlignmentGpuStatus = {
      accelerator: 'cuda',
      acceleratorLabel: 'CUDA',
      detectedGpu: 'Not checked',
      gpuTest: { state: 'not_checked' },
      alignment: { readiness: 'unknown', issues: [] },
      lastCheckedAt: null,
    };
    let releaseInitial: (() => void) | undefined;
    let releaseTest: (() => void) | undefined;
    let outcome = 0;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let json: unknown = [];
      if (path === '/auth/me') json = { id: 'admin', username: 'max', admin: true };
      if (path === '/setup/status') json = { available: false };
      if (path === '/system/diagnostics')
        json = {
          version: 'test',
          schema_version: 1,
          environment: 'test',
          database_status: 'ok',
          storage_status: 'ok',
          source_roots_configured: 0,
          source_roots_reachable: 0,
          failed_source_scans: 0,
          failed_alignment_jobs: 0,
          pending_source_scans: 0,
          pending_alignment_jobs: 0,
        };
      if (path === '/system/alignment') {
        await new Promise<void>((resolve) => {
          releaseInitial = resolve;
        });
        json = unchecked;
      }
      if (path === '/system/alignment/test') {
        expect(route.request().method()).toBe('POST');
        outcome++;
        if (outcome === 1)
          await new Promise<void>((resolve) => {
            releaseTest = resolve;
          });
        if (outcome === 2) {
          await route.fulfill({
            status: 409,
            body: 'alignment worker is busy; wait for the current job or test to finish',
          });
          return;
        }
        json = {
          ...unchecked,
          detectedGpu: 'NVIDIA GeForce GTX 1050 Ti (4.0 GB)',
          gpuTest: { state: 'success', detail: 'CUDA 12.6 · GPU calculation passed' },
          alignment:
            outcome === 1
              ? { readiness: 'not_ready', issues: ['Cached English model is missing.'] }
              : { readiness: 'ready', issues: [] },
          lastCheckedAt: '2026-09-24T18:00:00Z',
        };
      }
      if (path === '/system/alignment/test' && outcome >= 4) {
        json = {
          ...unchecked,
          accelerator: 'cpu',
          acceleratorLabel: 'CPU',
          gpuTest: { state: 'not_applicable' },
          alignment: outcome === 4
            ? { readiness: 'not_ready', issues: ["Runtime check failed: No module named 'torch'"] }
            : { readiness: 'ready', issues: [] },
        };
      }
      await route.fulfill({ json });
    });
    await page.goto('/system');
    await expect.poll(() => Boolean(releaseInitial)).toBe(true);
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    await expect.poll(() => Boolean(releaseTest)).toBe(true);
    await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(0);
    releaseTest!();
    await expect(page.getByText('Working', { exact: true })).toBeVisible();
    await expect(page.getByText('Cached English model is missing.', { exact: true })).toBeVisible();
    await expect(page.getByText('Not ready', { exact: true })).toBeVisible();
    const response = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/system/alignment'),
    );
    releaseInitial!();
    await response;
    await expect(
      page.getByText('NVIDIA GeForce GTX 1050 Ti (4.0 GB)', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    await expect(
      page.getByText('alignment worker is busy; wait for the current job or test to finish', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(page.getByText('Cached English model is missing.', { exact: true })).toHaveCount(
      0,
    );
    await page.getByText('Ready', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-system-gpu.png` });
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    await expect(page.getByText('No GPU is required.', { exact: false })).toBeVisible();
    await expect(page.getByText('GPU test', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Detected GPU', { exact: true })).toHaveCount(0);
    await expect(page.getByText("Runtime check failed: No module named 'torch'", { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(page.getByText("Runtime check failed: No module named 'torch'", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `../artifacts/design-redesign/${width}-system-cpu.png` });
  });
}
