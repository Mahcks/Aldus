const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const candidate = JSON.parse(fs.readFileSync(process.argv[2] || 'test-fixtures/alice/automatic/alignment.json'));
  const golden = JSON.parse(fs.readFileSync('test-fixtures/alice/anchors.json'));
  const anchors = golden.anchors.map((anchor) => {
    const segment = candidate.segments.find((item) => item.normalized_text.includes(anchor.normalized_text));
    return {
      ...anchor,
      text: segment.text,
      normalized_text: segment.normalized_text,
      epub: { ...segment.epub, cfi: '' },
      audio: {
        resource: segment.audio.resource,
        timestamp_ms: segment.audio.start_ms,
        seek: { requested_ms: segment.audio.start_ms, reported_ms: segment.audio.start_ms, difference_ms: 0 },
      },
    };
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:18081/anchors');
  await page.evaluate((fixture) => localStorage.setItem('aldus:alice:anchors:v3', JSON.stringify({ persistence_version: 3, fixture })), { ...golden, anchors });
  await page.reload();
  await page.getByText('10 anchors').waitFor();
  const results = [];
  for (const anchor of anchors) {
    const row = page.getByText(new RegExp(`^${anchor.id} ·`)).locator('..').locator('..');
    await row.getByText('Edit', { exact: true }).click();
    await page.getByText('Restore captured selection', { exact: true }).click();
    const restoration = page.getByText(/Restore (exact|failed):/);
    await restoration.waitFor();
    const restorationText = await restoration.textContent();
    if (!restorationText.startsWith('Restore exact:')) throw new Error(`${anchor.id}: ${restorationText}`);
    const input = page.getByText('Requested timestamp (ms)', { exact: true }).locator('..').locator('input');
    await input.fill(String(anchor.audio.timestamp_ms));
    await page.getByText('Seek + capture', { exact: true }).click();
    const diagnostic = await page.getByText(/^reported \d+ ms · difference/).textContent();
    results.push({ anchor_id: anchor.id, restored: true, diagnostic });
  }
  await browser.close();
  const output = `${JSON.stringify({ browser: 'Chrome for Testing 149.0.7827.55 (headless)', anchors: results }, null, 2)}\n`;
  if (process.argv[3]) fs.writeFileSync(process.argv[3], output); else process.stdout.write(output);
})().catch((error) => { console.error(error); process.exit(1); });
