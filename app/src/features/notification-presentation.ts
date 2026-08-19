import type { AppIconName } from './icons';

export function notificationIcon(kind: string): AppIconName {
  if (kind.includes('ready') || kind.includes('available') || kind.includes('approved')) {
    return 'check';
  }
  if (kind.includes('failed') || kind.includes('denied')) return 'error';
  if (kind.includes('review') || kind.includes('approval')) return 'warning';
  if (kind.includes('search') || kind.includes('watch')) return 'search';
  return 'acquire';
}

export function notificationTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  if (date >= startOfToday) return `Today, ${time}`;
  if (date >= startOfYesterday) return `Yesterday, ${time}`;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function notificationHref(value?: string): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//')) return undefined;
  return value;
}
