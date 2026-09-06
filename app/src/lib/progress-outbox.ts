import type { CanonicalPosition, WorkProgressUpdate } from '@/generated/api';
import { api } from './api';
import { activeStorageScope } from './storage-scope';
import { getAPIBaseURL } from './api-base';

export async function saveWorkProgress(
  workID: string,
  update: WorkProgressUpdate,
  scope = activeStorageScope(),
  origin = getAPIBaseURL(),
) {
  if (!scope || scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
    throw new Error('The active account changed. Progress was not sent.');
  }
  return api.updateWorkProgress(workID, update);
}

export async function reconcilePendingProgress(_workID: string): Promise<{
  local: WorkProgressUpdate;
  remote: CanonicalPosition;
} | null> {
  return null;
}

export async function pendingProgress(
  _workID: string,
  _scope?: string,
): Promise<WorkProgressUpdate | null> {
  return null;
}

export async function discardPendingProgress(_workID: string) {}

export async function reconcileAllPendingProgress() {}
