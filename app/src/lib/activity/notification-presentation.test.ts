import { describe, expect, test } from 'bun:test';
import {
  isAdministrativeNotification,
  notificationHref,
  notificationIcon,
  notificationStatus,
} from './notification-presentation';

describe('notification presentation', () => {
  test('only approval-needed notifications count as administrative', () => {
    expect(isAdministrativeNotification('acquisition.approval_needed')).toBeTrue();
    expect(isAdministrativeNotification('acquisition.pending_approval')).toBeFalse();
    expect(isAdministrativeNotification('acquisition.available')).toBeFalse();
    expect(isAdministrativeNotification('acquisition.failed')).toBeFalse();
  });

  test('shares the Requests tab status vocabulary for matching format states', () => {
    expect(notificationStatus('acquisition.available')).toEqual({
      label: 'Ready',
      tone: 'success',
      requestable: false,
    });
    expect(notificationStatus('acquisition.downloading')).toEqual({
      label: 'Downloading',
      tone: 'info',
      requestable: false,
    });
    expect(notificationStatus('acquisition.failed')).toEqual({
      label: 'Could not complete',
      tone: 'danger',
      requestable: true,
    });
  });

  test('gives notification-only transitions their own status', () => {
    expect(notificationStatus('acquisition.approval_needed')).toEqual({
      label: 'Needs approval',
      tone: 'warning',
      requestable: false,
    });
    expect(notificationStatus('acquisition.approved')).toEqual({
      label: 'Approved',
      tone: 'success',
      requestable: false,
    });
  });

  test('uses familiar icons without exposing event kinds', () => {
    expect(notificationIcon('acquisition.ready')).toBe('check');
    expect(notificationIcon('acquisition.needs_review')).toBe('warning');
    expect(notificationIcon('acquisition.failed')).toBe('error');
    expect(notificationIcon('request.searching')).toBe('search');
  });

  test('only opens paths inside Aldus', () => {
    expect(notificationHref('/work/hobbit')).toBe('/work/hobbit');
    expect(notificationHref('https://example.com')).toBeUndefined();
    expect(notificationHref('//example.com')).toBeUndefined();
  });
});
