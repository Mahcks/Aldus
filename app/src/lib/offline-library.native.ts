import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import type {
  Alignment,
  AlignmentJob,
  CanonicalPosition,
  RepresentationState,
  Work,
} from '../generated/api';
import type { MediaChoice } from '../features/consumption';
import { productEPUBSource } from './epub-source';
import { productAudioSource } from './media';
import { pendingProgress } from './progress-outbox';

export type OfflineWork = {
  work: Work;
  epubs: MediaChoice[];
  audio: MediaChoice[];
  jobs: AlignmentJob[];
  epub_id: string;
  audio_id: string;
  alignment?: Alignment;
  progress: CanonicalPosition | null;
  epub_state: RepresentationState | null;
  audio_state: RepresentationState | null;
  downloaded_at: string;
};

const key = (workID: string) => `aldus:offline-work:${workID}`;

export async function offlineWork(workID: string): Promise<OfflineWork | null> {
  const raw = await AsyncStorage.getItem(key(workID));
  if (!raw) return null;
  const value = JSON.parse(raw) as OfflineWork;
  const media = [...value.epubs, ...value.audio];
  if (
    media.some((item) => {
      const file = new File(
        Paths.document,
        `aldus-${item.id}.${item.representation.kind === 'epub' ? 'epub' : 'audio'}`,
      );
      return !file.exists || file.size !== item.size_bytes;
    })
  ) {
    await AsyncStorage.removeItem(key(workID));
    return null;
  }
  return value;
}

export async function downloadOfflineWork(value: Omit<OfflineWork, 'downloaded_at'>) {
  await Promise.all([
    ...value.epubs.map((item) => productEPUBSource(item.id, item.size_bytes)),
    ...value.audio.map((item) => productAudioSource(item.id, item.size_bytes)),
  ]);
  const stored = { ...value, downloaded_at: new Date().toISOString() };
  await AsyncStorage.setItem(key(value.work.id), JSON.stringify(stored));
  return stored;
}

export async function removeOfflineWork(workID: string) {
  if (await pendingProgress(workID))
    throw new Error('Sync this device before removing the download.');
  const value = await offlineWork(workID);
  for (const item of [...(value?.epubs ?? []), ...(value?.audio ?? [])]) {
    const file = new File(
      Paths.document,
      `aldus-${item.id}.${item.representation.kind === 'epub' ? 'epub' : 'audio'}`,
    );
    if (file.exists) file.delete();
  }
  await AsyncStorage.removeItem(key(workID));
}

export async function updateOfflineProgress(workID: string, progress: CanonicalPosition) {
  const value = await offlineWork(workID);
  if (value) await AsyncStorage.setItem(key(workID), JSON.stringify({ ...value, progress }));
}
