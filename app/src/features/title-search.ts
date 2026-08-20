import type { TitleRequestFormat } from '../generated/api';
import { acquisitionDate } from './acquisition';

export type TitleRequestPresentation = {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  requestable: boolean;
};

export function titleRequestPresentation(state?: string): TitleRequestPresentation | undefined {
  if (!state) return undefined;
  switch (state) {
    case 'pending_approval':
      return { label: 'Awaiting approval', tone: 'warning', requestable: false };
    case 'wanted':
    case 'searching':
      return {
        label: state === 'wanted' ? 'Requested' : 'Searching',
        tone: 'info',
        requestable: false,
      };
    case 'awaiting_release':
      return { label: 'Watching', tone: 'info', requestable: false };
    case 'downloading':
      return { label: 'Downloading', tone: 'info', requestable: false };
    case 'verifying':
    case 'scanning':
    case 'importing':
      return { label: 'Preparing', tone: 'info', requestable: false };
    case 'needs_review':
      return { label: 'Needs review', tone: 'warning', requestable: false };
    case 'available':
      return { label: 'Ready', tone: 'success', requestable: false };
    case 'denied':
      return { label: 'Declined', tone: 'danger', requestable: true };
    case 'failed':
      return { label: 'Could not complete', tone: 'danger', requestable: true };
    case 'canceled':
      return { label: 'Canceled', tone: 'neutral', requestable: true };
    default:
      return { label: 'Requested', tone: 'info', requestable: false };
  }
}

export function titleRequestDetail(format: TitleRequestFormat) {
  if (format.error) return format.error;
  switch (format.state) {
    case 'pending_approval':
      return 'Waiting for an owner to approve this request.';
    case 'wanted':
      return 'Queued for Aldus to search.';
    case 'searching':
      return 'Searching connected indexers now.';
    case 'awaiting_release':
      return format.next_search_at
        ? `No matching release yet. Searching again ${acquisitionDate(format.next_search_at)}.`
        : 'No matching release yet. Aldus will keep looking.';
    case 'downloading':
      return 'Sent to qBittorrent and downloading.';
    case 'verifying':
    case 'scanning':
    case 'importing':
      return 'Downloaded and being prepared for the library.';
    case 'needs_review':
      return 'The downloaded files need an owner to review the import.';
    case 'available':
      return 'Available in Aldus.';
    case 'denied':
      return 'An owner declined this request.';
    case 'canceled':
      return 'The requester canceled this request.';
    case 'failed':
      return 'Aldus could not complete this request.';
    default:
      return `Updated ${acquisitionDate(format.updated_at)}.`;
  }
}
