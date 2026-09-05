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
import { representationStateUpdate } from '@/features/offline-representation';
import { APIError, api } from './api';
import { DownloadInterrupted } from './download-interrupted';
import { getAPIBaseURL } from './api-base';
import { productEPUBSource } from './epub-source.native';
import { downloadProductAudio, productAudioFileName } from './media.native';
import {
  notifyDownloads,
  removeDownloadRecord,
  retryDownload,
  stopDownloads,
  stopServerDownloads,
} from './native-download.native';
import { pendingProgress } from './progress-outbox.native';
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
  pending_representation_states?: Partial<Record<'epub' | 'audio', boolean>>;
  audio_chapters: Record<string, AudioChapter[]>;
  downloaded_at: string;
};

// ponytail: one queue for short manifest mutations; split by account if contention becomes measurable.
let mutations = Promise.resolve();
function serialize<T>(mutation: () => Promise<T>) {
  const result = mutations.then(mutation);
  mutations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
const removals = new Set<string>();
const downloads = new Map<
  string,
  {
    promise: Promise<OfflineWork>;
    cancelled: boolean;
    value: Omit<OfflineWork, 'downloaded_at'>;
    scope: string;
    origin: string;
  }
>();

const key = (scope: string, workID: string) => scopedStorageKey(`offline-work:${workID}`, scope);
const pendingKey = (scope: string, workID: string) =>
  scopedStorageKey(`offline-pending:${workID}`, scope);
const prefix = (scope: string) => scopedStorageKey('offline-work:', scope);
const librariesKey = (scope: string) => scopedStorageKey('offline-libraries', scope);

function offlineMediaFile(item: MediaChoice, scope: string) {
  const name =
    item.representation.kind === 'epub'
      ? scopedMediaFileName(item.id, 'epub', scope)
      : productAudioFileName(item.id, item.original_filename, scope);
  return new File(Paths.document, name);
}

export async function offlineWorks(scope = activeStorageScope()): Promise<OfflineWork[]> {
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

export async function offlineLibraries(scope = activeStorageScope()): Promise<Library[]> {
  const [raw, works] = await Promise.all([
    AsyncStorage.getItem(librariesKey(scope)),
    offlineWorks(scope),
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
  const scope = activeStorageScope();
  const [works, libraries] = await Promise.all([offlineWorks(scope), offlineLibraries(scope)]);
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
  if (!scope) return null;
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
      const file = offlineMediaFile(item, scope);
      return !file.exists || file.size !== item.size_bytes;
    })
  ) {
    // Keep independently complete files and pending reading state available for retry.
    return null;
  }
  return value;
}

export function downloadOfflineWork(value: Omit<OfflineWork, 'downloaded_at'>) {
  const scope = activeStorageScope();
  const origin = getAPIBaseURL();
  const downloadKey = key(scope, value.work.id);
  if (removals.has(downloadKey))
    return Promise.reject(new Error('The download is being removed. Retry shortly.'));
  const existing = downloads.get(downloadKey);
  if (existing) return existing.promise;
  const owner = {
    promise: Promise.resolve({ ...value, downloaded_at: '' }),
    cancelled: false,
    value: { ...value },
    scope,
    origin,
  };
  downloads.set(downloadKey, owner);
  owner.promise = performDownload(owner).finally(() => {
    if (downloads.get(downloadKey) === owner) downloads.delete(downloadKey);
  });
  return owner.promise;
}

async function performDownload(owner: {
  cancelled: boolean;
  value: Omit<OfflineWork, 'downloaded_at'>;
  scope: string;
  origin: string;
}) {
  const { value, scope, origin } = owner;
  const check = () => {
    if (owner.cancelled || scope !== activeStorageScope() || origin !== getAPIBaseURL()) {
      throw new DownloadInterrupted('Download stopped. Return to this account to retry.');
    }
  };
  const existing = parseStoredJSON<OfflineWork>(
    await AsyncStorage.getItem(key(scope, value.work.id)),
  );
  check();
  if (existing) {
    if (!value.epubs.length && existing.epub_id === value.epub_id) value.epubs = existing.epubs;
    if (!value.audio.length && existing.audio_id === value.audio_id) value.audio = existing.audio;
  }
  if (
    existing &&
    (existing.pending_representation_states?.epub ||
      existing.pending_representation_states?.audio ||
      (await pendingProgress(value.work.id, scope))) &&
    (existing.epub_id !== value.epub_id || existing.audio_id !== value.audio_id)
  ) {
    throw new Error('Sync this device before changing the downloaded edition.');
  }
  await AsyncStorage.setItem(pendingKey(scope, value.work.id), JSON.stringify(value));
  check();
  const results = await Promise.allSettled([
    ...value.epubs.map((item) =>
      productEPUBSource(
        item.id,
        item.size_bytes,
        item.sha256,
        `${value.work.title}: Ebook`,
        value.work.id,
      ),
    ),
    ...value.audio.map((item) =>
      downloadProductAudio(
        item.id,
        item.size_bytes,
        item.original_filename,
        item.sha256,
        `${value.work.title}: Audiobook`,
        value.work.id,
      ),
    ),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    throw failed.reason;
  }
  check();
  return serialize(async () => {
    const previous = parseStoredJSON<OfflineWork>(
      await AsyncStorage.getItem(key(scope, value.work.id)),
    );
    check();
    const pending = await pendingProgress(value.work.id, scope);
    check();
    const stored = { ...value, downloaded_at: new Date().toISOString() };
    if (previous) {
      if (
        (previous.pending_representation_states?.epub ||
          previous.pending_representation_states?.audio ||
          pending) &&
        (previous.epub_id !== value.epub_id ||
          previous.audio_id !== value.audio_id ||
          (pending && previous.alignment?.id !== value.alignment?.id))
      ) {
        throw new Error('Sync this device before changing the downloaded edition.');
      }
      if (
        previous.progress &&
        previous.progress.alignment_id === (value.alignment?.id ?? value.progress?.alignment_id) &&
        (pending || (previous.progress.updated_at ?? '') > (value.progress?.updated_at ?? ''))
      )
        stored.progress = previous.progress;
      if (previous.pending_representation_states?.epub) stored.epub_state = previous.epub_state;
      if (previous.pending_representation_states?.audio) stored.audio_state = previous.audio_state;
      stored.pending_representation_states = previous.pending_representation_states;
    }
    await AsyncStorage.setItem(key(scope, value.work.id), JSON.stringify(stored));
    await AsyncStorage.removeItem(pendingKey(scope, value.work.id));
    notifyDownloads();
    return stored;
  });
}

export async function removeOfflineWork(workID: string, format?: 'epub' | 'audio') {
  const scope = activeStorageScope();
  const removalKey = key(scope, workID);
  if (removals.has(removalKey)) throw new Error('The download is already being removed.');
  removals.add(removalKey);
  try {
    await performRemoval(workID, scope, format);
  } finally {
    removals.delete(removalKey);
  }
}
async function performRemoval(workID: string, scope: string, format?: 'epub' | 'audio') {
  if (await pendingProgress(workID, scope))
    throw new Error('Sync this device before removing the download.');
  const owner = downloads.get(key(scope, workID));
  if (owner && format) throw new Error('Pause the downloads before removing a saved format.');
  if (owner) {
    owner.cancelled = true;
    for (const item of [...owner.value.epubs, ...owner.value.audio])
      await removeDownloadRecord(item.id, scope);
    await owner.promise.catch(() => {});
  }
  return serialize(async () => {
    const values = await Promise.all(
      [key(scope, workID), pendingKey(scope, workID)].map(async (storedKey) =>
        parseStoredJSON<OfflineWork>(await AsyncStorage.getItem(storedKey)),
      ),
    );
    if (
      values.some(
        (value) =>
          value?.pending_representation_states?.epub || value?.pending_representation_states?.audio,
      )
    ) {
      throw new Error('Sync this device before removing the download.');
    }
    for (const [index, value] of values.entries()) {
      if (value) {
        const removed = {
          epubs: format === 'audio' ? [] : value.epubs,
          audio: format === 'epub' ? [] : value.audio,
        };
        for (const item of [...removed.epubs, ...removed.audio])
          await removeDownloadRecord(item.id, scope);
        deleteOfflineFiles(removed, scope);
        const storedKey = index === 0 ? key(scope, workID) : pendingKey(scope, workID);
        if (format) {
          if (format === 'epub') value.epubs = [];
          else value.audio = [];
        }
        if (format && (value.epubs.length || value.audio.length)) {
          await AsyncStorage.setItem(storedKey, JSON.stringify(value));
        } else {
          await AsyncStorage.removeItem(storedKey);
        }
      }
    }
    notifyDownloads();
  });
}

function deleteOfflineFiles(value: Pick<OfflineWork, 'epubs' | 'audio'>, scope: string) {
  for (const item of [...value.epubs, ...value.audio]) {
    const file = offlineMediaFile(item, scope);
    if (file.exists) file.delete();
  }
}

export async function updateOfflineProgress(workID: string, progress: CanonicalPosition) {
  const scope = activeStorageScope();
  return serialize(async () => {
    if (scope !== activeStorageScope()) return;
    const value = await offlineWork(workID, scope);
    if (value)
      await AsyncStorage.setItem(key(scope, workID), JSON.stringify({ ...value, progress }));
  });
}

export async function updateOfflineRepresentationState(
  workID: string,
  kind: 'epub' | 'audio',
  state: RepresentationState,
  pending = false,
  scope = activeStorageScope(),
) {
  return serialize(async () => {
    if (scope !== activeStorageScope()) return false;
    const value = await offlineWork(workID, scope);
    if (!value) return false;
    await AsyncStorage.setItem(
      key(scope, workID),
      JSON.stringify({
        ...value,
        [kind === 'epub' ? 'epub_state' : 'audio_state']: state,
        pending_representation_states: {
          ...value.pending_representation_states,
          [kind]: pending,
        },
      }),
    );
    return true;
  });
}

export async function reconcileOfflineRepresentationStates() {
  const scope = activeStorageScope();
  if (!scope) return;
  const origin = getAPIBaseURL();
  const stillActive = () => origin === getAPIBaseURL() && scope === activeStorageScope();
  for (const work of await offlineWorks(scope)) {
    for (const kind of ['epub', 'audio'] as const) {
      if (!work.pending_representation_states?.[kind]) continue;
      const local = kind === 'epub' ? work.epub_state : work.audio_state;
      if (!local) continue;
      try {
        if (!stillActive()) return;
        let expectedRevision = local.revision;
        try {
          const remote = await api.representationState(local.representation_id);
          if (!stillActive()) return;
          expectedRevision = remote?.revision ?? 0;
        } catch (error) {
          if (!(error instanceof APIError && error.status === 404)) throw error;
          expectedRevision = 0;
        }
        if (!stillActive()) return;
        const saved = await api.updateRepresentationState(
          local.representation_id,
          representationStateUpdate(local, expectedRevision),
        );
        if (!stillActive()) return;
        await updateOfflineRepresentationState(work.work.id, kind, saved, false, scope);
      } catch {
        // Leave the local state pending for the next foreground attempt.
      }
    }
  }
}

export async function retryOfflineDownload(mediaID: string) {
  const scope = activeStorageScope();
  const prefix = scopedStorageKey('offline-pending:', scope);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  for (const storedKey of keys) {
    const value = parseStoredJSON<Omit<OfflineWork, 'downloaded_at'>>(
      await AsyncStorage.getItem(storedKey),
    );
    if (value && [...value.epubs, ...value.audio].some((item) => item.id === mediaID)) {
      if (scope !== activeStorageScope()) throw new Error('The account changed. Retry.');
      await downloadOfflineWork(value);
      return;
    }
  }
  if (scope !== activeStorageScope()) throw new Error('The account changed. Retry.');
  await retryDownload(mediaID);
}

export async function stopOfflineDownloads(scope: string) {
  const owners = [...downloads.values()].filter((owner) => owner.scope === scope);
  owners.forEach((owner) => {
    owner.cancelled = true;
  });
  await stopDownloads(scope);
  await Promise.allSettled(owners.map((owner) => owner.promise));
  await mutations;
}
export async function stopServerOfflineDownloads(origin: string) {
  const owners = [...downloads.values()].filter((owner) => owner.origin === origin);
  owners.forEach((owner) => {
    owner.cancelled = true;
  });
  await stopServerDownloads(origin);
  await Promise.allSettled(owners.map((owner) => owner.promise));
  await mutations;
}
