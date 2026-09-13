import type { AlignmentJob } from '@/generated/api';

export function alignmentJobHint(job: Pick<AlignmentJob, 'state' | 'error'>) {
  if (job.state === 'ready') return 'Readers can switch between reading and listening in sync.';
  if (job.state === 'stale')
    return 'One of the source files changed since this finished. Start a new alignment to keep sync accurate.';
  if (job.state === 'processing')
    return 'Preparing synchronized reading and listening on the server.';
  if (job.state !== 'failed') return 'Queued to begin shortly.';

  switch (job.error) {
    case 'worker timeout':
      return 'Sync reached the server’s time limit. Ask your server administrator to allow more time for long audiobooks, then retry sync.';
    case 'canceled':
      return 'Sync was canceled. Retry sync when you are ready.';
    case 'GPU acceleration unavailable; check the NVIDIA driver and Docker GPU access':
      return 'The server could not use GPU acceleration. Ask your server administrator to check GPU compatibility or use CPU alignment, then retry sync.';
    case 'worker interrupted twice':
      return 'Sync was interrupted repeatedly. Make sure the server can stay running, then retry sync.';
    case 'artifact validation failed':
      return 'The sync result could not be verified and was not published. Retry sync. If it fails again, ask your server administrator to check the alignment logs.';
    default:
      return 'Sync could not finish. Retry sync. If it fails again, ask your server administrator to check the alignment logs.';
  }
}

export function alignmentJobTone(
  state: string,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (state === 'ready') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'stale') return 'warning';
  if (state === 'processing') return 'info';
  return 'neutral';
}

export function alignmentJobLabel(state: string) {
  if (state === 'ready') return 'Ready';
  if (state === 'failed') return 'Needs attention';
  if (state === 'stale') return 'Out of date';
  if (state === 'processing') return 'Aligning';
  return 'Queued';
}

export function alignmentNoticeTone(state: string): 'info' | 'warning' | 'success' | 'danger' {
  if (state === 'ready') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'stale') return 'warning';
  return 'info';
}
