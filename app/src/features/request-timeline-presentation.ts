import type { TitleRequestEvent } from '@/generated/api';

// Collapse repeated outcomes, including their automatic search-start entries.
// A different outcome or a download/approval transition starts a new group.
export function groupRequestEvents(events: TitleRequestEvent[]) {
  const groups: { event: TitleRequestEvent; checks: number }[] = [];
  const outcomes = ['no_match', 'search_failed', 'submission_failed'];
  for (const event of events) {
    const previous = groups.at(-1);
    if (previous && previous.event.format === event.format) {
      if (event.event_type === 'search_started' && outcomes.includes(previous.event.event_type)) {
        continue;
      }
      if (outcomes.includes(event.event_type) && previous.event.event_type === event.event_type) {
        previous.checks += 1;
        continue;
      }
    }
    groups.push({ event, checks: outcomes.includes(event.event_type) ? 1 : 0 });
  }
  return groups;
}

export function requestEventDetail(state?: string, eventType?: string) {
  if (eventType === 'submission_failed') {
    return 'The download could not be sent to the download client. Aldus will retry.';
  }
  if (eventType === 'search_failed') {
    return 'The search could not complete. Aldus will retry.';
  }
  switch (state) {
    case 'pending_approval':
      return 'Submitted for approval.';
    case 'approved':
      return 'Approved and added to the search queue.';
    case 'wanted':
      return 'Added to the search queue.';
    case 'searching':
      return 'Searching connected indexers.';
    case 'awaiting_release':
      return 'No matching release yet. Aldus will keep looking.';
    case 'submitting':
      return 'Sending the selected book to the download client.';
    case 'downloading':
      return 'The download started.';
    case 'verifying':
    case 'scanning':
    case 'importing':
      return 'Preparing the downloaded files for the library.';
    case 'needs_review':
      return 'An owner needs to review the downloaded files.';
    case 'available':
      return 'Added to the library.';
    case 'denied':
      return 'The request was declined.';
    case 'canceled':
      return 'The request was canceled.';
    case 'failed':
      return 'Aldus could not complete this step.';
    default:
      return 'Request updated.';
  }
}
