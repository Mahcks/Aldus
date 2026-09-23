import { describe, expect, test } from 'bun:test';
import type { Notification, TitleRequest } from '@/generated/api';
import {
  groupNotifications,
  isCancelableRequestState,
  isTakingLonger,
  notificationAction,
  requestGroup,
} from './activity-presentation';

const request = (states: string[]) =>
  ({ formats: states.map((state) => ({ state })) }) as TitleRequest;

describe('activity request presentation', () => {
  test('groups requests by the most useful current state', () => {
    expect(requestGroup(request(['available', 'downloading']))).toBe('active');
    expect(requestGroup(request(['available']))).toBe('ready');
    expect(requestGroup(request(['failed', 'canceled']))).toBe('history');
  });

  test('only warns after 24 hours without a download update', () => {
    const now = Date.parse('2026-08-20T12:00:00Z');
    expect(isTakingLonger('downloading', '2026-08-19T11:59:59Z', now)).toBeTrue();
    expect(isTakingLonger('downloading', '2026-08-19T12:00:01Z', now)).toBeFalse();
    expect(isTakingLonger('submitting', '2026-08-18T12:00:00Z', now)).toBeFalse();
  });

  test('does not offer cancellation after import preparation begins', () => {
    expect(isCancelableRequestState('downloading')).toBeTrue();
    expect(isCancelableRequestState('scanning')).toBeFalse();
    expect(isCancelableRequestState('needs_review')).toBeFalse();
  });

  test('groups lifecycle updates for the same requested format', () => {
    const notifications = [
      {
        id: 'title-request:request-1:ebook:available',
        kind: 'acquisition.available',
        title: 'Ready to read',
        body: 'Catching Fire · Ebook',
        created_at: '2026-08-21T12:37:00Z',
      },
      {
        id: 'title-request:request-2:ebook:downloading',
        kind: 'acquisition.downloading',
        title: 'Download started',
        body: 'Catching Fire · Ebook',
        created_at: '2026-08-21T12:30:00Z',
        read_at: '2026-08-21T12:31:00Z',
      },
      {
        id: 'system-update',
        kind: 'system.update',
        title: 'System updated',
        created_at: '2026-08-21T12:00:00Z',
      },
    ] as Notification[];

    expect(groupNotifications(notifications)).toEqual([
      expect.objectContaining({
        key: 'request:catching fire:ebook',
        requestID: 'request-1',
        format: 'ebook',
        title: 'Catching Fire',
        administrative: false,
        latest: notifications[0],
        items: notifications.slice(0, 2),
        unreadCount: 1,
      }),
      expect.objectContaining({
        key: 'notification:system-update',
        administrative: false,
        latest: notifications[2],
        unreadCount: 1,
      }),
    ]);
  });

  test('keeps separate approval requests for the same book apart, even for a reviewer with their own matching request', () => {
    const notifications = [
      {
        id: 'title-request:request-a:ebook:approval-needed',
        kind: 'acquisition.approval_needed',
        title: 'Book request needs approval',
        body: 'Catching Fire · Ebook',
        created_at: '2026-08-21T12:40:00Z',
      },
      {
        id: 'title-request:request-b:ebook:approval-needed',
        kind: 'acquisition.approval_needed',
        title: 'Book request needs approval',
        body: 'Catching Fire · Ebook',
        created_at: '2026-08-21T12:39:00Z',
      },
      {
        id: 'title-request:request-c:ebook:downloading',
        kind: 'acquisition.downloading',
        title: 'Download started',
        body: 'Catching Fire · Ebook',
        created_at: '2026-08-21T12:38:00Z',
      },
    ] as Notification[];

    const groups = groupNotifications(notifications);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual(
      expect.objectContaining({
        key: 'admin-request:request-a:ebook',
        requestID: 'request-a',
        administrative: true,
        unreadCount: 1,
      }),
    );
    expect(groups[1]).toEqual(
      expect.objectContaining({
        key: 'admin-request:request-b:ebook',
        requestID: 'request-b',
        administrative: true,
        unreadCount: 1,
      }),
    );
    expect(groups[2]).toEqual(
      expect.objectContaining({
        key: 'request:catching fire:ebook',
        requestID: 'request-c',
        administrative: false,
        unreadCount: 1,
      }),
    );
  });

  test('picks the same primary action Home uses for a ready book', () => {
    const [readyGroup] = groupNotifications([
      {
        id: 'title-request:request-1:audiobook:available',
        kind: 'acquisition.available',
        title: 'Ready to listen',
        body: 'Catching Fire · Audiobook',
        action_url: '/consume/work-1?mode=listen',
        created_at: '2026-08-21T12:37:00Z',
      },
    ] as Notification[]);
    expect(notificationAction(readyGroup)).toEqual({
      label: 'Listen now',
      icon: 'listen',
      kind: 'primary',
    });
  });

  test('makes an administrative review a primary action but a personal in-progress update a secondary one', () => {
    const [adminGroup] = groupNotifications([
      {
        id: 'title-request:request-9:ebook:approval-needed',
        kind: 'acquisition.approval_needed',
        title: 'Book request needs approval',
        body: 'The Secret Garden · Ebook',
        action_url: '/acquisitions',
        created_at: '2026-08-21T12:37:00Z',
      },
    ] as Notification[]);
    expect(notificationAction(adminGroup)).toEqual({ label: 'Review', kind: 'primary' });

    const [downloadingGroup] = groupNotifications([
      {
        id: 'title-request:request-2:ebook:downloading',
        kind: 'acquisition.downloading',
        title: 'Download started',
        body: 'Catching Fire · Ebook',
        action_url: '/activity',
        created_at: '2026-08-21T12:37:00Z',
      },
    ] as Notification[]);
    expect(notificationAction(downloadingGroup)).toEqual({
      label: 'View request',
      kind: 'secondary',
    });
  });
});
