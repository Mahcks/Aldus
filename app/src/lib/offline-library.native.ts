import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import type {
  Alignment,
  AlignmentJob,
  AudioChapter,
  CanonicalPosition,
  RepresentationState,
  Library,
  WorkDetail,
  WorkSummary,
} from '../generated/api';
import type { MediaChoice } from '../features/consumption';
import { offlineAudioChapters } from '../features/offline-chapters';
import { productEPUBSource } from './epub-source';
import { productAudioSource } from './media';
import { pendingProgress } from './progress-outbox';
import { parseStoredJSON } from './stored-json';

export type OfflineWork = {
  work: WorkDetail;
  epubs: MediaChoice[];
  audio: MediaChoice[];
  jobs: AlignmentJob[];
  epub_id: string;
  audio_id: string;
  alignment?: Alignment;
  progress: CanonicalPosition | null;
  epub_state: RepresentationState | null;
  audio_state: RepresentationState | null;
  audio_chapters: Record<string, AudioChapter[]>;
  downloaded_at: string;
};

const key = (workID: string) => `aldus:offline-work:${workID}`;
const prefix = 'aldus:offline-work:';
const librariesKey = 'aldus:offline-libraries';

export async function offlineWorks(): Promise<OfflineWork[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  const values = await Promise.all(keys.map((item) => offlineWork(item.slice(prefix.length))));
  return values.filter((item): item is OfflineWork => Boolean(item));
}

export async function rememberOfflineLibraries(libraries: Library[]) {
  const raw = await AsyncStorage.getItem(librariesKey);
  const saved = parseStoredJSON<Library[]>(raw) ?? [];
  const merged = new Map(saved.map((item) => [item.id, item]));
  for (const library of libraries) merged.set(library.id, library);
  await AsyncStorage.setItem(librariesKey, JSON.stringify([...merged.values()]));
}

export async function offlineLibraries(): Promise<Library[]> {
  const [raw, works] = await Promise.all([AsyncStorage.getItem(librariesKey), offlineWorks()]);
  const saved = parseStoredJSON<Library[]>(raw) ?? [];
  const ids = new Set(works.map((item) => item.work.library_id));
  const libraries = new Map(
    saved.filter((item) => ids.has(item.id)).map((item) => [item.id, item]),
  );
  for (const item of works) {
    if (libraries.has(item.work.library_id)) continue;
    libraries.set(item.work.library_id, {
      id: item.work.library_id,
      name: 'Offline downloads',
      exclusive: false,
      effective: true,
      can_request_acquisitions: false,
      can_bypass_acquisition_approval: false,
      can_advanced_acquisition_request: false,
      created_at: item.work.created_at,
      updated_at: item.work.updated_at,
    });
  }
  return [...libraries.values()];
}

export async function offlineWorkSummaries(libraryID?: string): Promise<WorkSummary[]> {
  const [works, libraries] = await Promise.all([offlineWorks(), offlineLibraries()]);
  const byID = new Map(libraries.map((item) => [item.id, item]));
  return works
    .filter((item) => !libraryID || item.work.library_id === libraryID)
    .map((item) => {
      const library = byID.get(item.work.library_id);
      return {
        ...item.work,
        library_name: library?.name ?? 'Offline downloads',
        readable: item.epubs.length > 0,
        listenable: item.audio.length > 0,
        synchronized: Boolean(item.alignment),
        in_progress: Boolean(item.progress),
        completion_percent: item.work.completion_percent ?? 0,
        active_seconds: item.work.active_seconds ?? 0,
        reading_seconds: item.work.reading_seconds ?? 0,
        listening_seconds: item.work.listening_seconds ?? 0,
        last_mode: item.work.last_mode,
        reading_status: item.work.reading_status ?? '',
        progress_updated_at: item.work.progress_updated_at,
      };
    });
}

export async function offlineWork(workID: string): Promise<OfflineWork | null> {
  const raw = await AsyncStorage.getItem(key(workID));
  if (!raw) return null;
  const value = parseStoredJSON<OfflineWork>(raw);
  if (!value) {
    await AsyncStorage.removeItem(key(workID));
    return null;
  }
  value.audio_chapters = offlineAudioChapters(value.audio_chapters);
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
