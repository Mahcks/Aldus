import { describe, expect, test } from 'bun:test';
import { notificationHref, notificationIcon, notificationTime } from './notification-presentation';

describe('notification presentation', () => {
  test('uses familiar icons without exposing event kinds', () => {
    expect(notificationIcon('acquisition.ready')).toBe('check');
    expect(notificationIcon('acquisition.needs_review')).toBe('warning');
    expect(notificationIcon('acquisition.failed')).toBe('error');
    expect(notificationIcon('request.searching')).toBe('search');
  });

  test('describes recent dates relative to the reader', () => {
    const now = new Date(2026, 7, 18, 19, 0);
    expect(notificationTime('2026-08-18T12:30:00-05:00', now)).toContain('Today');
    expect(notificationTime('2026-08-17T12:30:00-05:00', now)).toContain('Yesterday');
    expect(notificationTime('not-a-date', now)).toBe('');
  });

  test('only opens paths inside Aldus', () => {
    expect(notificationHref('/work/hobbit')).toBe('/work/hobbit');
    expect(notificationHref('https://example.com')).toBeUndefined();
    expect(notificationHref('//example.com')).toBeUndefined();
  });
});
