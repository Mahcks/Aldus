import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanonicalPosition, WorkProgressUpdate } from '../generated/api';
import { APIError, api } from './api';
import { getAPIBaseURL } from './api-base';
import { parseStoredJSON } from './stored-json';
import { activeStorageScope, scopedStorageKey } from './storage-scope';

const key = (scope: string, workID: string) => scopedStorageKey(`progress-outbox:${workID}`, scope);
const indexKey = (scope: string) => scopedStorageKey('progress-outbox:index', scope);

async function pendingWorkIDs(scope: string) {
  const raw = await AsyncStorage.getItem(indexKey(scope));
  const ids = parseStoredJSON<unknown>(raw);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    if (raw) await AsyncStorage.removeItem(indexKey(scope));
    return [];
  }
  return ids;
}

async function track(scope: string, workID: string, pending: boolean) {
  const ids = await pendingWorkIDs(scope);
  const next = pending ? [...new Set([...ids, workID])] : ids.filter((id) => id !== workID);
  await AsyncStorage.setItem(indexKey(scope), JSON.stringify(next));
}

export async function pendingProgress(workID: string, scope = activeStorageScope()) {
  const raw = await AsyncStorage.getItem(key(scope, workID));
  const progress = parseStoredJSON<WorkProgressUpdate>(raw);
  if (raw && !progress) {
    await AsyncStorage.removeItem(key(scope, workID));
    await track(scope, workID, false);
  }
  return progress;
}

export async function saveWorkProgress(
  workID: string,
  update: WorkProgressUpdate,
): Promise<CanonicalPosition | null> {
  const scope = activeStorageScope();
  try {
    const saved = await api.updateWorkProgress(workID, update);
    await AsyncStorage.removeItem(key(scope, workID));
    await track(scope, workID, false);
    return saved;
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 0) throw error;
    await AsyncStorage.setItem(key(scope, workID), JSON.stringify(update));
    await track(scope, workID, true);
    return null;
  }
}

export async function reconcilePendingProgress(
  workID: string,
  scope = activeStorageScope(),
  origin = getAPIBaseURL(),
): Promise<{
  local: WorkProgressUpdate;
  remote: CanonicalPosition;
} | null> {
  const local = await pendingProgress(workID, scope);
  if (!local) return null;
  if (origin !== getAPIBaseURL()) throw new Error('Aldus server changed during progress sync.');
  const remote = await api.workProgress(workID);
  if ((remote?.revision ?? 0) !== local.expected_revision && remote) return { local, remote };
  if (origin !== getAPIBaseURL()) throw new Error('Aldus server changed during progress sync.');
  await api.updateWorkProgress(workID, local);
  await AsyncStorage.removeItem(key(scope, workID));
  await track(scope, workID, false);
  return null;
}

export async function reconcileAllPendingProgress() {
  const scope = activeStorageScope();
  const origin = getAPIBaseURL();
  for (const workID of await pendingWorkIDs(scope)) {
    try {
      await reconcilePendingProgress(workID, scope, origin);
    } catch {
      // Leave the item queued for the next foreground attempt.
    }
  }
}
