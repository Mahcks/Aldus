import type { Notification, TitleRequest } from '../generated/api';

export type RequestFilter = 'active' | 'ready' | 'history';

export type NotificationGroup = {
  key: string;
  requestID?: string;
  format?: string;
  title: string;
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

export function groupNotifications(items: Notification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();

  for (const item of items) {
    const request = requestNotification(item);
    const key = request
      ? `request:${request.title.trim().toLocaleLowerCase()}:${request.format}`
      : `notification:${item.id}`;
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
      latest: item,
      items: [item],
      unreadCount: item.read_at ? 0 : 1,
    });
  }

  return [...groups.values()];
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
