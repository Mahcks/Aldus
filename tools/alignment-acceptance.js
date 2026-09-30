const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const golden = JSON.parse(fs.readFileSync('test-fixtures/alice/anchors.json'));
  // Share the evaluator's locator and hash checks; never select by text alone.
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aldus-acceptance-'));
  let evaluation;
  try {
    const output = path.join(directory, 'evaluation.json');
    execFileSync('python3', ['tools/alignment.py', 'evaluate', '--candidate', process.argv[2] || 'test-fixtures/alice/automatic/alignment.json', '--anchors', 'test-fixtures/alice/anchors.json', '--output', output]);
    evaluation = JSON.parse(fs.readFileSync(output));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const anchors = golden.anchors.map((anchor) => {
    const match = evaluation.anchors.find((item) => item.anchor_id === anchor.id);
    if (match?.status !== 'matched') throw new Error(`${anchor.id}: ${match?.status}`);
    const timestamp = match.generated_timestamp_ms;
    return { ...anchor, audio: { ...anchor.audio, timestamp_ms: timestamp,
      seek: { requested_ms: timestamp, reported_ms: timestamp, difference_ms: 0 } } };
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:18081/anchors');
  await page.evaluate((fixture) => localStorage.setItem('aldus:alice:anchors:v3', JSON.stringify({ persistence_version: 3, fixture })), { ...golden, anchors });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByLabel(/^EPUB file:/).setInputFiles('test-fixtures/alice/pinned/alice.epub');
  await page.getByText('Hash verified.', { exact: true }).waitFor();
  await page.getByLabel(/^Audiobook file:/).setInputFiles('test-fixtures/alice/pinned/alice-chapter-01.mp3');
  await page.getByText(`${anchors.length} anchors`, { exact: true }).waitFor();
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
  const browserVersion = browser.version();
  await browser.close();
  const output = `${JSON.stringify({ browser: browserVersion, anchors: results }, null, 2)}\n`;
  if (process.argv[3]) fs.writeFileSync(process.argv[3], output); else process.stdout.write(output);
})().catch((error) => { console.error(error); process.exit(1); });
