import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanonicalPosition, WorkProgressUpdate } from '../generated/api';
import { APIError, api } from './api';

const key = (workID: string) => `aldus:progress-outbox:${workID}`;

export async function saveWorkProgress(
  workID: string,
  update: WorkProgressUpdate,
): Promise<CanonicalPosition | null> {
  try {
    const saved = await api.updateWorkProgress(workID, update);
    await AsyncStorage.removeItem(key(workID));
    return saved;
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 0) throw error;
    await AsyncStorage.setItem(key(workID), JSON.stringify(update));
    return null;
  }
}

export async function reconcilePendingProgress(workID: string): Promise<{
  local: WorkProgressUpdate;
  remote: CanonicalPosition;
} | null> {
  const raw = await AsyncStorage.getItem(key(workID));
  if (!raw) return null;
  const local = JSON.parse(raw) as WorkProgressUpdate;
  const remote = await api.workProgress(workID);
  if ((remote?.revision ?? 0) !== local.expected_revision && remote) return { local, remote };
  await api.updateWorkProgress(workID, local);
  await AsyncStorage.removeItem(key(workID));
  return null;
}
