import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WorkProgressUpdate } from '@/generated/api';
import { parseStoredJSON } from './stored-json';
import { activeStorageScope, scopedStorageKey } from './storage-scope';

const key = (scope: string, workID: string) => scopedStorageKey(`progress-outbox:${workID}`, scope);
const indexKey = (scope: string) => scopedStorageKey('progress-outbox:index', scope);
let mutations = Promise.resolve();

export function serializeProgressMutation<T>(mutation: () => Promise<T>) {
  const result = mutations.then(mutation);
  mutations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function pendingWorkIDs(scope: string) {
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

export async function readPendingProgress(workID: string, scope: string) {
  const raw = await AsyncStorage.getItem(key(scope, workID));
  const progress = parseStoredJSON<WorkProgressUpdate>(raw);
  if (raw && !progress) {
    await AsyncStorage.removeItem(key(scope, workID));
    await track(scope, workID, false);
  }
  return progress;
}

export async function discard(workID: string, scope: string) {
  await AsyncStorage.removeItem(key(scope, workID));
  await track(scope, workID, false);
}

export function pendingProgress(workID: string, scope = activeStorageScope()) {
  return serializeProgressMutation(() => readPendingProgress(workID, scope));
}

// Manifest mutations must not wait for the outbox queue: replay updates the manifest.
export async function pendingProgressSnapshot(workID: string, scope: string) {
  return parseStoredJSON<WorkProgressUpdate>(await AsyncStorage.getItem(key(scope, workID)));
}

export function discardPendingProgress(workID: string, scope = activeStorageScope()) {
  return serializeProgressMutation(() => discard(workID, scope));
}

// Called inside serializeProgressMutation, alongside the corresponding network operation.
export async function storePendingProgress(
  workID: string,
  update: WorkProgressUpdate,
  scope: string,
) {
  await AsyncStorage.setItem(key(scope, workID), JSON.stringify(update));
  await track(scope, workID, true);
}
