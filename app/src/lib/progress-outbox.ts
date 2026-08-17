import type { CanonicalPosition, WorkProgressUpdate } from '../generated/api';
import { api } from './api';

export async function saveWorkProgress(workID: string, update: WorkProgressUpdate) {
  return api.updateWorkProgress(workID, update);
}

export async function reconcilePendingProgress(_workID: string): Promise<{
  local: WorkProgressUpdate;
  remote: CanonicalPosition;
} | null> {
  return null;
}
