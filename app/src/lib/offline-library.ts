import type { CanonicalPosition } from '../generated/api';
import type { OfflineWork } from './offline-library.native';

export type { OfflineWork };
export async function offlineWork(_workID: string): Promise<OfflineWork | null> {
  return null;
}
export async function downloadOfflineWork(_value: Omit<OfflineWork, 'downloaded_at'>) {
  throw new Error('Offline downloads are available in the iOS and Android apps.');
}
export async function removeOfflineWork(_workID: string) {}
export async function updateOfflineProgress(_workID: string, _progress: CanonicalPosition) {}
