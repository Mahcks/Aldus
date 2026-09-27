import * as storage from './progress-outbox-storage';
import type { CanonicalPosition, WorkProgressUpdate } from '@/generated/api';
import { APIError, api } from './api';
import { OwnershipSupersededError, readingProofForWork } from './consumption/reading-proof';
import { getAPIBaseURL } from './api-base';
import { activeStorageScope } from './storage-scope';

import {
  discard,
  pendingWorkIDs,
  pendingAttempt,
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
  const acknowledgments = new Map<
    string,
    { update: WorkProgressUpdate; saved: CanonicalPosition }
  >();

  async function submit(workID: string, update: WorkProgressUpdate) {
    const origin = getAPIBaseURL();
    const scope = activeStorageScope();
    const stillActive = () => origin === getAPIBaseURL() && scope === activeStorageScope();
    try {
      return await api.updateWorkProgress(workID, update);
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 409 || !update.ownership) throw error;
      if (!stillActive()) throw error;
      const remote = await api.workProgress(workID);
      if (
        !stillActive() ||
        !remote ||
        remote.revision !== update.expected_revision + 1 ||
        remote.alignment_id !== update.alignment_id ||
        remote.segment_id !== update.segment_id ||
        remote.offset !== update.offset
      )
        throw error;
      await api.refreshReadingSession(workID, update.ownership);
      if (!stillActive()) throw error;
      return remote;
    }
  }

  function sameOwner(left: WorkProgressUpdate, right: WorkProgressUpdate) {
    if (!left.ownership && !right.ownership) return true;
    return Boolean(
      left.ownership &&
      right.ownership &&
      left.ownership.device_id === right.ownership.device_id &&
      left.ownership.epoch === right.ownership.epoch,
    );
  }

  async function acknowledge(
    workID: string,
    keyScope: string,
    update: WorkProgressUpdate,
    saved: CanonicalPosition,
    scope: string,
  ) {
    await updateOfflineProgress(workID, saved, scope);
    acknowledgments.set(JSON.stringify([keyScope, workID]), { update, saved });
    await discard(workID, keyScope);
  }

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
      if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
        await storePendingProgress(workID, update, keyScope);
        throw new Error('The active account changed. Progress is saved for the original reader.');
      }
      const prior =
        (await pendingAttempt(workID, keyScope)) ?? (await readPendingProgress(workID, keyScope));
      if (prior && !sameOwner(prior, update)) {
        throw new APIError(409, 'A saved place from another reading session needs a choice.');
      }
      await storePendingProgress(workID, update, keyScope, prior ?? undefined);
      if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
        throw new Error('The active account changed. Progress is saved for the original reader.');
      }
      if (prior && sameOwner(prior, update)) {
        try {
          const saved = await submit(workID, prior);
          await updateOfflineProgress(workID, saved, scope);
          acknowledgments.set(JSON.stringify([keyScope, workID]), { update: prior, saved });
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 0) throw error;
          // Still offline: retain the latest intent against the original revision.
          await storePendingProgress(
            workID,
            { ...update, expected_revision: prior.expected_revision },
            keyScope,
            prior,
          );
          return null;
        }
      }
      const acknowledged = acknowledgments.get(JSON.stringify([keyScope, workID]));
      if (
        acknowledged &&
        update.ownership &&
        sameOwner(acknowledged.update, update) &&
        update.expected_revision === acknowledged.update.expected_revision
      ) {
        update = {
          ...update,
          expected_revision: acknowledged.saved.revision ?? update.expected_revision,
        };
      }
      // Account and ownership may have changed while recovering the previous write.
      if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
        throw new Error('The active account changed during progress sync.');
      }
      await storePendingProgress(workID, update, keyScope);
      if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
        throw new Error('The active account changed. Progress is saved for the original reader.');
      }
      try {
        const saved = await submit(workID, update);
        await acknowledge(workID, keyScope, update, saved, scope);
        return saved;
      } catch (error) {
        // This request was explicitly refused, not lost in transit. Do not
        // replay a stale-device gesture as an offline saved-place conflict.
        if (error instanceof OwnershipSupersededError) await discard(workID, keyScope);
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
      const attempted = (await pendingAttempt(workID, keyScope)) ?? local;
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      const remote = await api.workProgress(workID);
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      if (
        (remote?.revision ?? 0) !== attempted.expected_revision &&
        remote &&
        (!attempted.ownership ||
          remote.revision !== attempted.expected_revision + 1 ||
          remote.alignment_id !== attempted.alignment_id ||
          remote.segment_id !== attempted.segment_id ||
          remote.offset !== attempted.offset)
      )
        return { local, remote };
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      let saved: CanonicalPosition;
      try {
        saved = await submit(workID, { ...attempted, ownership: attempted.ownership });
        if (!stillActive())
          throw new Error('Aldus server or account changed during progress sync.');
        if (!sameOwner(attempted, local)) return { local, remote: saved };
        if (
          local.alignment_id !== attempted.alignment_id ||
          local.segment_id !== attempted.segment_id ||
          local.offset !== attempted.offset
        ) {
          const next = { ...local, expected_revision: saved.revision! };
          await storePendingProgress(workID, next, keyScope);
          saved = await submit(workID, next);
        }
      } catch (error) {
        if (
          error instanceof OwnershipSupersededError ||
          (error instanceof APIError && error.status === 409)
        )
          return { local, remote: await api.workProgress(workID) };
        throw error;
      }
      if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
      await acknowledge(workID, keyScope, local, saved, scope);
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
