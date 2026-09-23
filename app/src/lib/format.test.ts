import { describe, expect, test } from 'bun:test';
import { formatDuration, formatMediaSize, relativeTime } from './format';

describe('format', () => {
  test('rounds durations to the nearest minute', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
    expect(formatDuration(80 * 60)).toBe('1h 20m');
  });

  test('formats media sizes', () => {
    expect(formatMediaSize(2048)).toBe('2 KB');
    expect(formatMediaSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  test('describes recent dates relative to the reader', () => {
    const now = new Date(2026, 7, 18, 19, 0);
    expect(relativeTime('2026-08-18T12:30:00-05:00', now)).toContain('Today');
    expect(relativeTime('2026-08-17T12:30:00-05:00', now)).toContain('Yesterday');
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});
