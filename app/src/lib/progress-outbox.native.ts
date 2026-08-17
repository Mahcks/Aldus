import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanonicalPosition, WorkProgressUpdate } from '../generated/api';
import { APIError, api } from './api';
import { parseStoredJSON } from './stored-json';

const key = (workID: string) => `aldus:progress-outbox:${workID}`;
const indexKey = 'aldus:progress-outbox:index';

async function pendingWorkIDs() {
  const raw = await AsyncStorage.getItem(indexKey);
  const ids = parseStoredJSON<unknown>(raw);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    if (raw) await AsyncStorage.removeItem(indexKey);
    return [];
  }
  return ids;
}

async function track(workID: string, pending: boolean) {
  const ids = await pendingWorkIDs();
  const next = pending ? [...new Set([...ids, workID])] : ids.filter((id) => id !== workID);
  await AsyncStorage.setItem(indexKey, JSON.stringify(next));
}

export async function pendingProgress(workID: string) {
  const raw = await AsyncStorage.getItem(key(workID));
  const progress = parseStoredJSON<WorkProgressUpdate>(raw);
  if (raw && !progress) {
    await AsyncStorage.removeItem(key(workID));
    await track(workID, false);
  }
  return progress;
}

export async function saveWorkProgress(
  workID: string,
  update: WorkProgressUpdate,
): Promise<CanonicalPosition | null> {
  try {
    const saved = await api.updateWorkProgress(workID, update);
    await AsyncStorage.removeItem(key(workID));
    await track(workID, false);
    return saved;
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 0) throw error;
    await AsyncStorage.setItem(key(workID), JSON.stringify(update));
    await track(workID, true);
    return null;
  }
}

export async function reconcilePendingProgress(workID: string): Promise<{
  local: WorkProgressUpdate;
  remote: CanonicalPosition;
} | null> {
  const local = await pendingProgress(workID);
  if (!local) return null;
  const remote = await api.workProgress(workID);
  if ((remote?.revision ?? 0) !== local.expected_revision && remote) return { local, remote };
  await api.updateWorkProgress(workID, local);
  await AsyncStorage.removeItem(key(workID));
  await track(workID, false);
  return null;
}

export async function reconcileAllPendingProgress() {
  for (const workID of await pendingWorkIDs()) {
    try {
      await reconcilePendingProgress(workID);
    } catch {
      // Leave the item queued for the next foreground attempt.
    }
  }
}
