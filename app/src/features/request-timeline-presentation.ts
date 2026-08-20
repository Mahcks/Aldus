export function requestEventDetail(state?: string) {
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
