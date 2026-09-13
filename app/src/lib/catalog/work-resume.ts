import type { WorkSummary } from '@/generated/api';

export function workResumeMode(work: Pick<WorkSummary, 'last_mode' | 'readable' | 'listenable'>) {
  if (work.last_mode === 'listen' && work.listenable) return 'listen';
  if (work.readable) return 'read';
  if (work.listenable) return 'listen';
  return undefined;
}
