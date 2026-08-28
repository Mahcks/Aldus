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
} from '@/generated/api';
import type { MediaChoice } from '@/features/consumption';
import { offlineAudioChapters } from '@/features/offline-chapters';
import { productEPUBSource } from './epub-source';
import { downloadProductAudio } from './media';
import { pendingProgress } from './progress-outbox';
import { parseStoredJSON } from './stored-json';
import { activeStorageScope, scopedMediaFileName, scopedStorageKey } from './storage-scope';

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

const key = (scope: string, workID: string) => scopedStorageKey(`offline-work:${workID}`, scope);
const prefix = (scope: string) => scopedStorageKey('offline-work:', scope);
const librariesKey = (scope: string) => scopedStorageKey('offline-libraries', scope);

export async function offlineWorks(): Promise<OfflineWork[]> {
  const scope = activeStorageScope();
  const scopedPrefix = prefix(scope);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(scopedPrefix));
  const values = await Promise.all(
    keys.map((item) => offlineWork(item.slice(scopedPrefix.length), scope)),
  );
  return values.filter((item): item is OfflineWork => Boolean(item));
}

export async function rememberOfflineLibraries(libraries: Library[]) {
  const scope = activeStorageScope();
  const raw = await AsyncStorage.getItem(librariesKey(scope));
  const saved = parseStoredJSON<Library[]>(raw) ?? [];
  const merged = new Map(saved.map((item) => [item.id, item]));
  for (const library of libraries) merged.set(library.id, library);
  await AsyncStorage.setItem(librariesKey(scope), JSON.stringify([...merged.values()]));
}

export async function offlineLibraries(): Promise<Library[]> {
  const scope = activeStorageScope();
  const [raw, works] = await Promise.all([
    AsyncStorage.getItem(librariesKey(scope)),
    offlineWorks(),
  ]);
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
      const progressUpdatedAt = [
        item.work.progress_updated_at,
        item.progress?.updated_at,
        item.epub_state?.epub_locator ? item.epub_state.updated_at : undefined,
        item.audio_state?.audio_timestamp_ms != null ? item.audio_state.updated_at : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      return {
        ...item.work,
        library_name: library?.name ?? 'Offline downloads',
        readable: item.epubs.length > 0,
        listenable: item.audio.length > 0,
        synchronized: Boolean(item.alignment),
        in_progress: Boolean(
          item.progress ||
          item.epub_state?.epub_locator ||
          item.audio_state?.audio_timestamp_ms != null,
        ),
        completion_percent: item.work.completion_percent ?? 0,
        active_seconds: item.work.active_seconds ?? 0,
        reading_seconds: item.work.reading_seconds ?? 0,
        listening_seconds: item.work.listening_seconds ?? 0,
        last_mode: item.work.last_mode,
        reading_status: item.work.reading_status ?? '',
        progress_updated_at: progressUpdatedAt,
      };
    });
}

export async function offlineWork(
  workID: string,
  scope = activeStorageScope(),
): Promise<OfflineWork | null> {
  const raw = await AsyncStorage.getItem(key(scope, workID));
  if (!raw) return null;
  const value = parseStoredJSON<OfflineWork>(raw);
  if (!value) {
    await AsyncStorage.removeItem(key(scope, workID));
    return null;
  }
  value.audio_chapters = offlineAudioChapters(value.audio_chapters);
  const media = [...value.epubs, ...value.audio];
  if (
    media.some((item) => {
      const file = new File(
        Paths.document,
        scopedMediaFileName(item.id, item.representation.kind === 'epub' ? 'epub' : 'audio', scope),
      );
      return !file.exists || file.size !== item.size_bytes;
    })
  ) {
    deleteOfflineFiles(value, scope);
    await AsyncStorage.removeItem(key(scope, workID));
    return null;
  }
  return value;
}

export async function downloadOfflineWork(value: Omit<OfflineWork, 'downloaded_at'>) {
  const scope = activeStorageScope();
  const results = await Promise.allSettled([
    ...value.epubs.map((item) => productEPUBSource(item.id, item.size_bytes)),
    ...value.audio.map((item) => downloadProductAudio(item.id, item.size_bytes)),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    deleteOfflineFiles(value, scope);
    throw failed.reason;
  }
  const stored = { ...value, downloaded_at: new Date().toISOString() };
  await AsyncStorage.setItem(key(scope, value.work.id), JSON.stringify(stored));
  return stored;
}

export async function removeOfflineWork(workID: string) {
  const scope = activeStorageScope();
  if (await pendingProgress(workID))
    throw new Error('Sync this device before removing the download.');
  const value = await offlineWork(workID);
  if (value) deleteOfflineFiles(value, scope);
  await AsyncStorage.removeItem(key(scope, workID));
}

function deleteOfflineFiles(value: Pick<OfflineWork, 'epubs' | 'audio'>, scope: string) {
  for (const item of [...value.epubs, ...value.audio]) {
    const file = new File(
      Paths.document,
      scopedMediaFileName(item.id, item.representation.kind === 'epub' ? 'epub' : 'audio', scope),
    );
    if (file.exists) file.delete();
  }
}

export async function updateOfflineProgress(workID: string, progress: CanonicalPosition) {
  const scope = activeStorageScope();
  const value = await offlineWork(workID);
  if (value) await AsyncStorage.setItem(key(scope, workID), JSON.stringify({ ...value, progress }));
}

export async function updateOfflineRepresentationState(
  workID: string,
  kind: 'epub' | 'audio',
  state: RepresentationState,
) {
  const scope = activeStorageScope();
  const value = await offlineWork(workID);
  if (!value) return false;
  await AsyncStorage.setItem(
    key(scope, workID),
    JSON.stringify({
      ...value,
      [kind === 'epub' ? 'epub_state' : 'audio_state']: state,
    }),
  );
  return true;
}
