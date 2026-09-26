import * as storage from './progress-outbox-storage';
import type { CanonicalPosition, WorkProgressUpdate } from '@/generated/api';
import { APIError, api } from './api';
import { OwnershipSupersededError, readingProofForWork } from './consumption/reading-proof';
import { getAPIBaseURL } from './api-base';
import { activeStorageScope } from './storage-scope';

import {
  discard,
  pendingWorkIDs,
  readPendingProgress,
  serializeProgressMutation,
  storePendingProgress,
} from './progress-outbox-storage';

// Native caches acknowledged positions in its downloaded-book manifest. Web
// keeps each tab's pending writes separate; both use the same revision/proof rules.
export function createProgressOutbox(
  updateOfflineProgress: (
    workID: string,
    progress: CanonicalPosition,
    scope: string,
  ) => Promise<void>,
  storageScope: (scope: string) => Promise<string>,
) {
  async function pendingProgress(workID: string, scope = activeStorageScope()) {
    const keyScope = await storageScope(scope);
    return storage.pendingProgress(workID, keyScope);
  }
  async function pendingProgressSnapshot(workID: string, scope: string) {
    return storage.pendingProgressSnapshot(workID, await storageScope(scope));
  }
  async function discardPendingProgress(workID: string, scope = activeStorageScope()) {
    return storage.discardPendingProgress(workID, await storageScope(scope));
  }
  function saveWorkProgress(
    workID: string,
    update: WorkProgressUpdate,
    scope = activeStorageScope(),
    origin = getAPIBaseURL(),
  ): Promise<CanonicalPosition | null> {
    if (!scope)
      return Promise.reject(new Error('The active account changed. Sign in before saving.'));
    // Freeze the originating claim before enqueueing or yielding. Replay must
    // never upgrade an old position to whichever device owns the book later.
    if (!('ownership' in update)) update = { ...update, ownership: readingProofForWork(workID) };
    return serializeProgressMutation(async () => {
      // A suspended app must retain this update even if the request never returns.
      const keyScope = await storageScope(scope);
      await storePendingProgress(workID, update, keyScope);
      if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
        throw new Error('The active account changed. Progress is saved for the original reader.');
      }
      try {
        const saved = await api.updateWorkProgress(workID, update);
        await updateOfflineProgress(workID, saved, scope);
        await discard(workID, keyScope);
        return saved;
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 0) throw error;
        return null;
      }
    });
  }

  function reconcilePendingProgress(
    workID: string,
    scope = activeStorageScope(),
    origin = getAPIBaseURL(),
  ): Promise<{
    local: WorkProgressUpdate;
    remote: CanonicalPosition | null;
  } | null> {
    return serializeProgressMutation(async () => {
      const stillActive = () => origin === getAPIBaseURL() && scope === activeStorageScope();
      const keyScope = await storageScope(scope);
      const local = await readPendingProgress(workID, keyScope);
      if (!local) return null;
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      const remote = await api.workProgress(workID);
      if ((remote?.revision ?? 0) !== local.expected_revision && remote) return { local, remote };
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      let saved: CanonicalPosition;
      try {
        saved = await api.updateWorkProgress(workID, { ...local, ownership: local.ownership });
      } catch (error) {
        if (error instanceof OwnershipSupersededError) return { local, remote };
        throw error;
      }
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      await updateOfflineProgress(workID, saved, scope);
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      await discard(workID, keyScope);
      return null;
    });
  }

  async function reconcileAllPendingProgress() {
    const scope = activeStorageScope();
    if (!scope) return;
    const origin = getAPIBaseURL();
    const keyScope = await storageScope(scope);
    for (const workID of await serializeProgressMutation(() => pendingWorkIDs(keyScope))) {
      try {
        await reconcilePendingProgress(workID, scope, origin);
      } catch {
        // Leave the item queued for the next foreground attempt.
      }
    }
  }

  return {
    saveWorkProgress,
    reconcilePendingProgress,
    reconcileAllPendingProgress,
    pendingProgress,
    pendingProgressSnapshot,
    discardPendingProgress,
  };
}
