import type { CanonicalPosition, WorkProgressUpdate } from '@/generated/api';
import { APIError, api } from './api';
import { getAPIBaseURL } from './api-base';
import { updateOfflineProgress } from './offline-library.native';
import { activeStorageScope } from './storage-scope';

import {
  discard,
  pendingWorkIDs,
  readPendingProgress,
  serializeProgressMutation,
  storePendingProgress,
} from './progress-outbox-storage.native';

export {
  discardPendingProgress,
  pendingProgress,
  pendingProgressSnapshot,
} from './progress-outbox-storage.native';

export function saveWorkProgress(
  workID: string,
  update: WorkProgressUpdate,
  scope = activeStorageScope(),
  origin = getAPIBaseURL(),
): Promise<CanonicalPosition | null> {
  if (!scope) return Promise.reject(new Error('No active Aldus account.'));
  return serializeProgressMutation(async () => {
    // A suspended app must retain this update even if the request never returns.
    await storePendingProgress(workID, update, scope);
    if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
      throw new Error('The active account changed. Progress is saved for the original reader.');
    }
    try {
      const saved = await api.updateWorkProgress(workID, update);
      await updateOfflineProgress(workID, saved, scope);
      await discard(workID, scope);
      return saved;
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 0) throw error;
      return null;
    }
  });
}

export function reconcilePendingProgress(
  workID: string,
  scope = activeStorageScope(),
  origin = getAPIBaseURL(),
): Promise<{
  local: WorkProgressUpdate;
  remote: CanonicalPosition;
} | null> {
  return serializeProgressMutation(async () => {
    const stillActive = () => origin === getAPIBaseURL() && scope === activeStorageScope();
    const local = await readPendingProgress(workID, scope);
    if (!local) return null;
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    const remote = await api.workProgress(workID);
    if ((remote?.revision ?? 0) !== local.expected_revision && remote) return { local, remote };
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    const saved = await api.updateWorkProgress(workID, local);
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    await updateOfflineProgress(workID, saved, scope);
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    await discard(workID, scope);
    return null;
  });
}

export async function reconcileAllPendingProgress() {
  const scope = activeStorageScope();
  if (!scope) return;
  const origin = getAPIBaseURL();
  for (const workID of await serializeProgressMutation(() => pendingWorkIDs(scope))) {
    try {
      await reconcilePendingProgress(workID, scope, origin);
    } catch {
      // Leave the item queued for the next foreground attempt.
    }
  }
}
