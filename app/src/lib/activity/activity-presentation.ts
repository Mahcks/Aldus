import type { Notification, TitleRequest } from '@/generated/api';
import type { AppIconName } from '@/components/ui/icons';
import { isAdministrativeNotification, notificationHref } from './notification-presentation';

export type RequestFilter = 'active' | 'ready' | 'history';

export type NotificationGroup = {
  key: string;
  requestID?: string;
  format?: string;
  title: string;
  /** Sent to library reviewers about someone else's request, never the reader's own. */
  administrative: boolean;
  latest: Notification;
  items: Notification[];
  unreadCount: number;
};

const terminalStates = new Set(['available', 'denied', 'canceled', 'failed']);

export function isActiveRequestState(state: string) {
  return !terminalStates.has(state);
}

export function isCancelableRequestState(state: string) {
  return [
    'pending_approval',
    'wanted',
    'searching',
    'awaiting_release',
    'submitting',
    'downloading',
  ].includes(state);
}

export function requestGroup(request: TitleRequest): RequestFilter {
  if (request.formats.some((format) => isActiveRequestState(format.state))) return 'active';
  if (request.formats.some((format) => format.state === 'available')) return 'ready';
  return 'history';
}

export function isTakingLonger(state: string, updatedAt: string, now = Date.now()) {
  return state === 'downloading' && now - new Date(updatedAt).getTime() > 24 * 60 * 60 * 1000;
}

/**
 * The grouping key for a personal (non-administrative) request's lifecycle
 * notifications — same book, same format merge under this key regardless of
 * which request ID produced the latest event. Exported so a request row can
 * look up its own notification group by title/format without duplicating
 * this exact string-matching rule.
 */
export function personalGroupKey(title: string, format: string) {
  return `request:${title.trim().toLocaleLowerCase()}:${format}`;
}

export function groupNotifications(items: Notification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();

  for (const item of items) {
    const request = requestNotification(item);
    const administrative = isAdministrativeNotification(item.kind);
    // Personal lifecycle updates for the same book/format merge into one card
    // (e.g. downloading -> available). Administrative "needs approval" events
    // never merge by title: two different readers requesting the same book
    // must both stay visible to the reviewer, so each keeps its own request.
    const key = !request
      ? `notification:${item.id}`
      : administrative
        ? `admin-request:${request.id}:${request.format}`
        : personalGroupKey(request.title, request.format);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      if (!item.read_at) existing.unreadCount += 1;
      continue;
    }

    groups.set(key, {
      key,
      requestID: request?.id,
      format: request?.format,
      title: request?.title ?? item.title,
      administrative,
      latest: item,
      items: [item],
      unreadCount: item.read_at ? 0 : 1,
    });
  }

  return [...groups.values()];
}

export type NotificationAction = {
  label: string;
  icon?: AppIconName;
  kind: 'primary' | 'secondary';
};

/**
 * A book that's finished downloading gets the same "Read now"/"Listen now"
 * primary action as Home's ready shelf — the same event, so the same call
 * to action. An administrative approval is also a primary action (it's the
 * one thing the reviewer came here to do); everything still in progress
 * only offers a quieter way to go look.
 */
export function notificationAction(group: NotificationGroup): NotificationAction | undefined {
  const href = notificationHref(group.latest.action_url);
  const canConsume = Boolean(href?.startsWith('/consume/'));
  if (canConsume) {
    return {
      label: group.format === 'audiobook' ? 'Listen now' : 'Read now',
      icon: group.format === 'audiobook' ? 'listen' : 'read',
      kind: 'primary',
    };
  }
  if (group.administrative) return { label: 'Review', kind: 'primary' };
  if (group.requestID) return { label: 'View request', kind: 'secondary' };
  if (href) return { label: 'Open', kind: 'secondary' };
  return undefined;
}

export function requestNotification(item: Notification) {
  const match = /^title-request:([^:]+):(ebook|audiobook):/.exec(item.id);
  if (!match) return undefined;
  const separator = item.body?.lastIndexOf(' · ') ?? -1;
  return {
    id: match[1],
    format: match[2],
    title: separator > 0 ? item.body!.slice(0, separator) : item.body || item.title,
  };
}
