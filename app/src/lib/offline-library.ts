import type { CanonicalPosition, Library, RepresentationState, WorkSummary } from '@/generated/api';
import type { OfflineWork } from './offline-library.native';

export type { OfflineWork };
export async function offlineWork(_workID: string): Promise<OfflineWork | null> {
  return null;
}
export async function offlineWorks(): Promise<OfflineWork[]> {
  return [];
}
export async function rememberOfflineLibraries(_libraries: Library[]) {}
export async function offlineLibraries(): Promise<Library[]> {
  return [];
}
export async function offlineWorkSummaries(_libraryID?: string): Promise<WorkSummary[]> {
  return [];
}
export async function downloadOfflineWork(_value: Omit<OfflineWork, 'downloaded_at'>) {
  throw new Error('Offline downloads are available in the iOS and Android apps.');
}
export async function removeOfflineWork(_workID: string, _format?: 'epub' | 'audio') {}
export async function updateOfflineProgress(_workID: string, _progress: CanonicalPosition) {}
export async function updateOfflineRepresentationState(
  _workID: string,
  _kind: 'epub' | 'audio',
  _state: RepresentationState,
  _pending = false,
) {
  return false;
}
export async function reconcileOfflineRepresentationStates() {}

export async function retryOfflineDownload(_mediaID: string) {}
