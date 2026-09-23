import type { AppIconName } from '@/components/ui/icons';
import {
  titleRequestPresentation,
  type TitleRequestPresentation,
} from '@/lib/acquisitions/title-search';

/**
 * Same status vocabulary as the Requests tab's format badges, so a book's
 * state reads identically whether it showed up as a request row or an
 * update. `approval_needed` and `approved` aren't request-format states
 * (the format itself rests at `pending_approval`/`wanted`) — they're
 * notification-only transitions, so they're mapped here instead of in
 * `titleRequestPresentation`.
 */
export function notificationStatus(kind: string): TitleRequestPresentation {
  if (isAdministrativeNotification(kind)) {
    return { label: 'Needs approval', tone: 'warning', requestable: false };
  }
  const transition = kind.replace(/^acquisition\./, '');
  if (transition === 'approved') {
    return { label: 'Approved', tone: 'success', requestable: false };
  }
  return (
    titleRequestPresentation(transition) ?? {
      label: 'Updated',
      tone: 'neutral',
      requestable: false,
    }
  );
}

/**
 * The only notification kind sent to library reviewers/admins about someone
 * else's request; every other kind goes to the single reader who owns the
 * request it describes. Drives the personal/administrative split in Activity.
 */
export function isAdministrativeNotification(kind: string): boolean {
  return kind === 'acquisition.approval_needed';
}

export function notificationIcon(kind: string): AppIconName {
  if (kind.includes('ready') || kind.includes('available') || kind.includes('approved')) {
    return 'check';
  }
  if (kind.includes('failed') || kind.includes('denied')) return 'error';
  if (kind.includes('review') || kind.includes('approval')) return 'warning';
  if (kind.includes('search') || kind.includes('watch')) return 'search';
  return 'acquire';
}

export function notificationHref(value?: string): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//')) return undefined;
  return value;
}
