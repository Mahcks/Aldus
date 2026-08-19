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
