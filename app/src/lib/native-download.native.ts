import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { createDownloadResumable, FileSystemSessionType } from 'expo-file-system/legacy';
import type { DownloadResumable } from 'expo-file-system/legacy';
import { DownloadInterrupted } from './download-interrupted';
import { getAPIBaseURL } from './api-base';
import { getToken } from './auth-token';
import { APIError } from './api';
import { activeStorageScope, scopedStorageKey } from './storage-scope';
import type { DownloadItem } from './native-download';

export type { DownloadItem } from './native-download';

const chunkSize = 4 * 1024 * 1024;
const listeners = new Set<() => void>();
const running = new Map<
  string,
  {
    item: DownloadItem;
    promise: Promise<string>;
    task?: DownloadResumable;
    stopped?: boolean;
    oversized?: boolean;
    wake?: () => void;
  }
>();
let active = 0;
const queue: (() => void)[] = [];
const key = (item: Pick<DownloadItem, 'scope' | 'id'>) =>
  scopedStorageKey(`download:${item.id}`, item.scope);
const file = (item: DownloadItem, suffix = '') =>
  new File(Paths.document, `${item.filename}${suffix}`);

export function notifyDownloads() {
  for (const listener of listeners) listener();
}
export function subscribeDownloads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
async function save(item: DownloadItem) {
  await AsyncStorage.setItem(key(item), JSON.stringify(item));
  notifyDownloads();
}
function checkAccount(item: DownloadItem) {
  if (item.scope !== activeStorageScope() || item.origin !== getAPIBaseURL()) {
    throw new DownloadInterrupted('Download paused. Return to the original account to resume.');
  }
}
function discard(item: DownloadItem, suffix: string) {
  const target = file(item, suffix);
  if (target.exists) target.delete();
}

export async function listDownloads(): Promise<DownloadItem[]> {
  const scope = activeStorageScope();
  if (!scope) return [];
  const prefix = scopedStorageKey('download:', scope);
  const keys = (await AsyncStorage.getAllKeys()).filter((value) => value.startsWith(prefix));
  const items: DownloadItem[] = [];
  for (const storedKey of keys) {
    const raw = await AsyncStorage.getItem(storedKey);
    if (!raw) continue;
    try {
      const item = JSON.parse(raw) as DownloadItem;
      if (item.scope !== scope || key(item) !== storedKey) continue;
      const current = running.get(storedKey)?.item;
      const storageBytes = ['', '.part', '.chunk'].reduce((total, suffix) => {
        const target = file(item, suffix);
        return total + (target.exists ? target.size : 0);
      }, 0);
      items.push(
        current
          ? { ...current, storageBytes }
          : {
              ...item,
              storageBytes,
              status:
                item.status === 'downloading' || item.status === 'queued' ? 'paused' : item.status,
            },
      );
    } catch {
      /* A malformed transfer is never resumed. */
    }
  }
  return items;
}

export async function downloadNativeMedia(input: Omit<DownloadItem, 'bytes' | 'status'>) {
  if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize <= 0) {
    throw new Error('The download size is missing. Refresh the book and retry.');
  }
  checkAccount({ ...input, bytes: 0, status: 'queued' });
  const transferKey = key(input);
  const existing = running.get(transferKey);
  if (existing) {
    if (
      existing.item.filename !== input.filename ||
      existing.item.expectedSize !== input.expectedSize ||
      (existing.item.sha256 && input.sha256 && existing.item.sha256 !== input.sha256)
    )
      throw new Error('The download source changed. Retry.');
    existing.item.sha256 ??= input.sha256;
    if (input.workID) {
      existing.item.workID = input.workID;
      existing.item.label = input.label;
    }
    return existing.promise;
  }
  const owner = {
    item: { ...input, bytes: 0, status: 'queued', error: undefined } as DownloadItem,
    promise: Promise.resolve(''),
    task: undefined as DownloadResumable | undefined,
    stopped: false,
    oversized: false,
    wake: undefined as (() => void) | undefined,
  };
  // Register before any await, so duplicate callers share exactly one writer.
  running.set(transferKey, owner);
  owner.promise = execute(owner).finally(() => {
    if (running.get(transferKey) === owner) running.delete(transferKey);
    notifyDownloads();
  });
  return owner.promise;
}

async function execute(owner: {
  item: DownloadItem;
  task?: DownloadResumable;
  stopped?: boolean;
  oversized?: boolean;
  wake?: () => void;
}) {
  const item = owner.item;
  let acquired = false;
  const check = () => {
    if (owner.oversized) throw new Error('The download exceeded its expected size. Retry.');
    checkAccount(item);
    if (owner.stopped) throw new DownloadInterrupted('Download paused. Resume when you are ready.');
  };
  try {
    const raw = await AsyncStorage.getItem(key(item));
    if (raw) {
      const previous = JSON.parse(raw) as DownloadItem;
      if (
        previous.expectedSize !== item.expectedSize ||
        (previous.sha256 && item.sha256 && previous.sha256 !== item.sha256)
      ) {
        discard(item, '');
        discard(item, '.part');
      }
      if (
        previous.origin === item.origin &&
        previous.scope === item.scope &&
        previous.filename === item.filename &&
        previous.expectedSize === item.expectedSize &&
        (!previous.sha256 || !item.sha256 || previous.sha256 === item.sha256) &&
        Number.isSafeInteger(previous.bytes) &&
        previous.bytes >= 0 &&
        previous.bytes <= item.expectedSize
      ) {
        item.bytes = previous.bytes;
        item.sha256 ??= previous.sha256;
        if (!item.workID && previous.workID) {
          item.workID = previous.workID;
          item.label = previous.label;
        }
      }
    }
    check();
    const destination = file(item);
    if (destination.exists && destination.size === item.expectedSize) {
      item.bytes = item.expectedSize;
      item.status = 'complete';
      await save(item);
      return destination.uri;
    }
    if (destination.exists) destination.delete();
    const partial = file(item, '.part');
    // A process can die between append and checkpoint; discard those ambiguous bytes.
    if (!partial.exists || partial.size !== item.bytes) {
      discard(item, '.part');
      item.bytes = 0;
    }
    await save(item);
    check();
    if (active >= 2) {
      acquired = await new Promise<boolean>((resolve) => {
        const ready = () => {
          owner.wake = undefined;
          resolve(true);
        };
        queue.push(ready);
        owner.wake = () => {
          const index = queue.indexOf(ready);
          if (index >= 0) queue.splice(index, 1);
          owner.wake = undefined;
          resolve(false);
        };
      });
    } else {
      active++;
      acquired = true;
    }
    check();
    item.status = 'downloading';
    await save(item);
    while (item.bytes < item.expectedSize) {
      check();
      discard(item, '.chunk');
      const start = item.bytes;
      const end = Math.min(start + chunkSize, item.expectedSize) - 1;
      const token = await getToken(item.origin);
      check();
      const temporary = file(item, '.chunk');
      owner.task = createDownloadResumable(
        `${item.origin}/api/v1/media/${encodeURIComponent(item.id)}`,
        temporary.uri,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Range: `bytes=${start}-${end}`,
          },
          sessionType: FileSystemSessionType.FOREGROUND,
        },
        (progress) => {
          if (progress.totalBytesWritten > item.expectedSize) owner.oversized = true;
          if (item.scope !== activeStorageScope() || item.origin !== getAPIBaseURL()) {
            owner.stopped = true;
          }
          if (owner.oversized || owner.stopped) {
            void owner.task?.cancelAsync().catch(() => {});
          }
          item.transferredBytes = Math.min(
            (progress.totalBytesExpectedToWrite === item.expectedSize ? 0 : start) +
              progress.totalBytesWritten,
            item.expectedSize,
          );
          notifyDownloads();
        },
      );
      const task = owner.task;
      let response;
      try {
        response = await task.downloadAsync();
      } finally {
        await task.cancelAsync();
        owner.task = undefined;
      }
      check();
      if (!response) throw new Error('The download was interrupted. Retry to resume.');
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sign in to the original account, then resume this download.');
      }
      if (response.status === 404) {
        throw new APIError(
          404,
          'This file is unavailable on the server. Ask a library administrator to check the source folder and rescan it.',
        );
      }
      if (response.status >= 500 && response.status <= 599) {
        throw new Error('The server is unavailable. Resume the download when it is reachable.');
      }
      const headers = new Map(
        Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
      const range = headers.get('content-range');
      const expectedRange = `bytes ${start}-${end}/${item.expectedSize}`;
      const complete = response.status === 200 && !range && temporary.size === item.expectedSize;
      const ranged =
        response.status === 206 && range === expectedRange && temporary.size === end - start + 1;
      const contentLength = headers.get('content-length');
      if (
        (!complete && !ranged) ||
        (contentLength != null && Number(contentLength) !== temporary.size) ||
        (headers.get('content-encoding') && headers.get('content-encoding') !== 'identity')
      ) {
        console.warn('Aldus download response validation failed.', {
          status: response.status,
          expectedRange,
          receivedRange: range ?? null,
          expectedSize: item.expectedSize,
          receivedSize: temporary.size,
          contentLength: contentLength ?? null,
          contentEncoding: headers.get('content-encoding') ?? null,
        });
        discard(item, '.part');
        item.bytes = 0;
        throw new Error('The download response was invalid or incomplete. Retry.');
      }
      if (complete) {
        discard(item, '.part');
        await temporary.move(partial);
        item.bytes = item.expectedSize;
      } else {
        if (!partial.exists) partial.create();
        const source = temporary.open();
        try {
          const target = partial.open();
          try {
            target.offset = start;
            for (let remaining = temporary.size; remaining > 0;) {
              const bytes = source.readBytes(Math.min(64 * 1024, remaining));
              if (!bytes.length) throw new Error('The downloaded file could not be read. Retry.');
              target.writeBytes(bytes);
              remaining -= bytes.length;
            }
          } finally {
            target.close();
          }
        } finally {
          source.close();
        }
        item.bytes = end + 1;
      }
      item.transferredBytes = item.bytes;
      await save(item);
      discard(item, '.chunk');
    }
    check();
    if (!partial.exists || partial.size !== item.expectedSize) {
      discard(item, '.part');
      item.bytes = 0;
      throw new Error('The download was incomplete. Retry.');
    }
    await partial.move(destination);
    check();
    if (!destination.exists || destination.size !== item.expectedSize) {
      discard(item, '');
      throw new Error('The download could not be finalized. Retry.');
    }
    item.status = 'complete';
    await save(item);
    return destination.uri;
  } catch (error) {
    const interrupted =
      !owner.oversized &&
      (owner.stopped || item.scope !== activeStorageScope() || item.origin !== getAPIBaseURL());
    let failure = error;
    if (owner.oversized) {
      discard(item, '');
      discard(item, '.part');
      item.bytes = 0;
      item.transferredBytes = 0;
      failure = new Error('The download exceeded its expected size. Retry.');
    } else if (interrupted && !(error instanceof DownloadInterrupted)) {
      failure = new DownloadInterrupted('Download paused. Resume when you are ready.');
    }
    item.status = interrupted ? 'paused' : 'failed';
    item.error = failure instanceof Error ? failure.message : 'Download failed. Retry.';
    await save(item);
    throw failure;
  } finally {
    discard(item, '.chunk');
    if (acquired) {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  }
}

export async function stopDownloads(scope: string) {
  const owners = [...running.values()].filter((owner) => owner.item.scope === scope);
  for (const owner of owners) {
    owner.stopped = true;
    owner.wake?.();
  }
  await Promise.all(owners.map((owner) => owner.task?.cancelAsync()));
  await Promise.allSettled(owners.map((owner) => owner.promise));
}
export async function pauseDownload(id: string) {
  const owner = running.get(key({ scope: activeStorageScope(), id }));
  if (owner) {
    owner.stopped = true;
    owner.wake?.();
    await owner.task?.cancelAsync();
    await owner.promise.catch(() => {});
  }
}
export async function retryDownload(id: string) {
  const item = (await listDownloads()).find((entry) => entry.id === id);
  if (!item) throw new Error('Download not found.');
  return downloadNativeMedia(item);
}
export async function cancelDownload(id: string) {
  return removeDownloadRecord(id, activeStorageScope());
}
export async function removeDownloadRecord(id: string, scope: string) {
  const owner = running.get(key({ scope, id }));
  const raw = await AsyncStorage.getItem(key({ scope, id }));
  const item = raw ? (JSON.parse(raw) as DownloadItem) : owner?.item;
  if (owner) {
    owner.stopped = true;
    owner.wake?.();
    await owner.task?.cancelAsync();
    await owner.promise.catch(() => {});
  }
  if (!item || item.scope !== scope) return;
  // Completed media may still carry unsynchronized reading progress; remove via the work action.
  discard(item, '.part');
  discard(item, '.chunk');
  await AsyncStorage.removeItem(key(item));
  notifyDownloads();
}

export async function stopServerDownloads(origin: string) {
  const scopes = new Set(
    [...running.values()]
      .filter((owner) => owner.item.origin === origin)
      .map((owner) => owner.item.scope),
  );
  await Promise.all([...scopes].map(stopDownloads));
}
