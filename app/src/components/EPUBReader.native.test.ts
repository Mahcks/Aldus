import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('native restoration cannot finish or accept input before the destination event', () => {
  const result = spawnSync(process.execPath, ['run', 'e2e/fixtures/native-reader-restore.ts'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
