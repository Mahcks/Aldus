import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanonicalPosition, WorkProgressUpdate } from '@/generated/api';
import { APIError, api } from './api';
import { getAPIBaseURL } from './api-base';
import { parseStoredJSON } from './stored-json';
import { activeStorageScope, scopedStorageKey } from './storage-scope';

const key = (scope: string, workID: string) => scopedStorageKey(`progress-outbox:${workID}`, scope);
const indexKey = (scope: string) => scopedStorageKey('progress-outbox:index', scope);
let mutations = Promise.resolve();

function serialize<T>(mutation: () => Promise<T>) {
  const result = mutations.then(mutation);
  mutations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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

async function readPendingProgress(workID: string, scope: string) {
  const raw = await AsyncStorage.getItem(key(scope, workID));
  const progress = parseStoredJSON<WorkProgressUpdate>(raw);
  if (raw && !progress) {
    await AsyncStorage.removeItem(key(scope, workID));
    await track(scope, workID, false);
  }
  return progress;
}

async function discard(workID: string, scope: string) {
  await AsyncStorage.removeItem(key(scope, workID));
  await track(scope, workID, false);
}

export function pendingProgress(workID: string, scope = activeStorageScope()) {
  return serialize(() => readPendingProgress(workID, scope));
}

export function discardPendingProgress(workID: string, scope = activeStorageScope()) {
  return serialize(() => discard(workID, scope));
}

export function saveWorkProgress(
  workID: string,
  update: WorkProgressUpdate,
): Promise<CanonicalPosition | null> {
  const scope = activeStorageScope();
  return serialize(async () => {
    try {
      const saved = await api.updateWorkProgress(workID, update);
      await discard(workID, scope);
      return saved;
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 0) throw error;
      await AsyncStorage.setItem(key(scope, workID), JSON.stringify(update));
      await track(scope, workID, true);
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
  return serialize(async () => {
    const stillActive = () => origin === getAPIBaseURL() && scope === activeStorageScope();
    const local = await readPendingProgress(workID, scope);
    if (!local) return null;
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    const remote = await api.workProgress(workID);
    if ((remote?.revision ?? 0) !== local.expected_revision && remote) return { local, remote };
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    await api.updateWorkProgress(workID, local);
    if (!stillActive()) throw new Error('Aldus server or account changed during progress sync.');
    await discard(workID, scope);
    return null;
  });
}

export async function reconcileAllPendingProgress() {
  const scope = activeStorageScope();
  if (!scope) return;
  const origin = getAPIBaseURL();
  for (const workID of await serialize(() => pendingWorkIDs(scope))) {
    try {
      await reconcilePendingProgress(workID, scope, origin);
    } catch {
      // Leave the item queued for the next foreground attempt.
    }
  }
}
