import { expect, test } from 'bun:test';
import { formatBytes } from './system-presentation';

test('backup sizes stay readable from bytes through terabytes', () => {
  expect(formatBytes(800)).toBe('800 B');
  expect(formatBytes(1536)).toBe('1.5 KB');
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  expect(formatBytes(12 * 1024 * 1024 * 1024)).toBe('12 GB');
});
