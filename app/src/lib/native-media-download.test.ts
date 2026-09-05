import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const files = new Map<string, number>();
const contents = new Map<string, Uint8Array>();
const sourceBytes = (start: number, size: number) =>
  Uint8Array.from({ length: size }, (_, i) => (start + i) % 251);
let holdRequests = false;
let onRequest = () => {};
let onToken = () => {};
let token: string | null = null;
let cookieAuthenticated = false;
let requestHeaders: Record<string, string>[] = [];
let failingMedia = '';
let onWrite = async (_key: string) => {};
let releases: (() => void)[] = [];
let downloadSize = 12;
let responseStatus = 206;
let progressBytes: number | undefined;
let malformedRange = false;
let interruptAfter = 0;
let requests: string[] = [];
const storage = new Map<string, string>();
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      await onWrite(key);
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    getAllKeys: async () => [...storage.keys()],
    multiRemove: async (keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
    },
  },
}));
mock.module('./auth-token', () => ({
  getToken: async () => {
    onToken();
    return token;
  },
  setToken: async () => {},
  clearToken: async () => {},
}));
mock.module('expo-file-system/legacy', () => ({
  FileSystemSessionType: { FOREGROUND: 0 },
  createDownloadResumable: (
    _url: string,
    uri: string,
    options: { headers: Record<string, string> },
    callback: (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
  ) => {
    let cancelled = false;
    let release = () => {};
    return {
      cancelAsync: async () => {
        cancelled = true;
        release();
      },
      downloadAsync: async () => {
        const range = options.headers.Range;
        requests.push(range);
        requestHeaders.push({ ...options.headers });
        const wait = holdRequests
          ? new Promise<void>((resolve) => {
              release = resolve;
              releases.push(resolve);
            })
          : Promise.resolve();
        onRequest();
        await wait;
        if (cancelled) return undefined;
        if (!options.headers.Authorization && !cookieAuthenticated)
          return { status: 401, headers: {} };
        if (failingMedia && _url.endsWith(`/${failingMedia}`)) throw new Error('Connection lost');
        if (interruptAfter && requests.length > interruptAfter) throw new Error('Connection lost');
        const [, first, last] = /bytes=(\d+)-(\d+)/.exec(range)!;
        const start = Number(first);
        const end = Math.min(Number(last), downloadSize - 1);
        const size = responseStatus === 200 ? downloadSize : Math.max(0, end - start + 1);
        files.set(uri, progressBytes ?? size);
        contents.set(uri, sourceBytes(responseStatus === 200 ? 0 : start, size));
        callback({ totalBytesWritten: progressBytes ?? size, totalBytesExpectedToWrite: size });
        if (cancelled) return undefined;
        return {
          status: responseStatus,
          headers:
            responseStatus === 206
              ? {
                  'Content-Range': malformedRange ? 'bad' : `bytes ${start}-${end}/${downloadSize}`,
                }
              : {},
        };
      },
    };
  },
}));

class FakeFile {
  uri: string;

  constructor(...parts: unknown[]) {
    const values = parts.map(String);
    this.uri =
      values.length === 1
        ? values[0]
        : `${values[0].replace(/\/?$/, '/')}${values.slice(1).join('/')}`;
  }

  get name() {
    return this.uri.split('/').at(-1)!;
  }

  get exists() {
    return files.has(this.uri);
  }

  get size() {
    return files.get(this.uri) ?? 0;
  }

  create() {
    files.set(this.uri, 0);
    contents.set(this.uri, new Uint8Array());
  }

  open() {
    const uri = this.uri;
    return {
      offset: 0,
      readBytes(size: number) {
        const value = contents.get(uri)!.slice(this.offset, this.offset + size);
        this.offset += value.length;
        return value;
      },
      writeBytes(bytes: Uint8Array) {
        const value = new Uint8Array(Math.max(files.get(uri) ?? 0, this.offset + bytes.length));
        value.set(contents.get(uri) ?? new Uint8Array());
        value.set(bytes, this.offset);
        contents.set(uri, value);
        this.offset += bytes.length;
        files.set(uri, Math.max(files.get(uri) ?? 0, this.offset));
      },
      close() {},
    };
  }

  delete() {
    files.delete(this.uri);
    contents.delete(this.uri);
  }

  async move(destination: FakeFile) {
    await Promise.resolve();
    const size = files.get(this.uri);
    if (size == null) throw new Error('source does not exist');
    files.delete(this.uri);
    files.set(destination.uri, size);
    contents.set(destination.uri, contents.get(this.uri)!);
    contents.delete(this.uri);
    this.uri = destination.uri;
  }

  static async downloadFileAsync(_url: string, destination: FakeFile) {
    files.set(destination.uri, downloadSize);
    return destination;
  }
}

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('expo-file-system', () => ({
  File: FakeFile,
  Paths: {
    document: {
      toString: () => 'file:///documents/',
      list: () => [...files.keys()].map((uri) => new FakeFile(uri)),
    },
  },
}));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const { productEPUBSource } = await import('./epub-source.native');
const { downloadProductAudio } = await import('./media.native');
const { setStorageUserID } = await import('./storage-scope');
const originalAPIBaseURL = getAPIBaseURL();

beforeEach(() => {
  token = 'test-session';
  cookieAuthenticated = false;
  requestHeaders = [];
  failingMedia = '';
  onWrite = async () => {};
  files.clear();
  contents.clear();
  holdRequests = false;
  onRequest = () => {};
  onToken = () => {};
  releases = [];
  downloadSize = 12;
  responseStatus = 206;
  progressBytes = undefined;
  malformedRange = false;
  interruptAfter = 0;
  requests = [];
  storage.clear();
  setAPIBaseURL('http://localhost:8080');
  setStorageUserID('reader');
});

afterEach(() => {
  token = null;
  onToken = () => {};
  setAPIBaseURL(originalAPIBaseURL);
  setStorageUserID('');
});

test('native downloads retain finalized EPUB and audio files after move mutates the source URI', async () => {
  const epub = await productEPUBSource('epub-success', downloadSize);
  const audio = await downloadProductAudio('audio-success', downloadSize, 'Chapter.MP3');

  expect(files.get(epub)).toBe(downloadSize);
  expect(files.get(audio)).toBe(downloadSize);
  expect(audio.endsWith('.mp3')).toBe(true);
  expect([...files.keys()].some((uri) => uri.endsWith('.part') || uri.endsWith('.chunk'))).toBe(
    false,
  );
});

test('native downloads remove incomplete files without publishing them', async () => {
  downloadSize = 11;

  await expect(productEPUBSource('epub-incomplete', 12)).rejects.toThrow('incomplete');
  await expect(downloadProductAudio('audio-incomplete', 12, 'chapter.m4b')).rejects.toThrow(
    'incomplete',
  );

  expect([...files.keys()].some((uri) => uri.includes('epub-incomplete'))).toBe(false);
  expect([...files.keys()].some((uri) => uri.includes('audio-incomplete'))).toBe(false);
});

test('native transfer retains validated chunks after interruption and retries from the checkpoint', async () => {
  downloadSize = 4 * 1024 * 1024 + 12;
  interruptAfter = 1;
  await expect(downloadProductAudio('resume', downloadSize)).rejects.toThrow('Connection lost');
  expect([...files.entries()].find(([uri]) => uri.endsWith('.part'))?.[1]).toBe(4 * 1024 * 1024);
  interruptAfter = 0;
  const uri = await downloadProductAudio('resume', downloadSize);
  expect(requests.at(-1)).toBe(`bytes=4194304-${downloadSize - 1}`);
  expect(files.get(uri)).toBe(downloadSize);
  expect(contents.get(uri)).toEqual(sourceBytes(0, downloadSize));
  expect([...files.keys()].some((uri) => uri.endsWith('.part') || uri.endsWith('.chunk'))).toBe(
    false,
  );
  expect([...storage.values()].some((value) => value.includes('test-session'))).toBe(false);
});

test('full 200 safely replaces a partial and malformed range removes invalid bytes', async () => {
  downloadSize = 4 * 1024 * 1024 + 12;
  interruptAfter = 1;
  await expect(downloadProductAudio('full', downloadSize)).rejects.toThrow('Connection lost');
  interruptAfter = 0;
  responseStatus = 200;
  const uri = await downloadProductAudio('full', downloadSize);
  expect(contents.get(uri)).toEqual(sourceBytes(0, downloadSize));
  expect(files.get(uri)).toBe(downloadSize);
  responseStatus = 206;
  malformedRange = true;
  await expect(productEPUBSource('invalid-range', downloadSize)).rejects.toThrow('invalid');
  expect([...files.keys()].some((uri) => uri.includes('invalid-range'))).toBe(false);
});

test('duplicate native requests share a single writer', async () => {
  await Promise.all([productEPUBSource('duplicate', 12), productEPUBSource('duplicate', 12)]);
  expect(requests).toHaveLength(1);
});

test('two transfers run at once and a queued cancellation does not wait for them', async () => {
  const { cancelDownload } = await import('./native-download.native');
  holdRequests = true;
  let started!: () => void;
  const twoStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  onRequest = () => {
    if (requests.length === 2) started();
  };
  const first = productEPUBSource('first', 12);
  const second = productEPUBSource('second', 12);
  await twoStarted;
  const third = productEPUBSource('third', 12).catch((error) => error);
  await cancelDownload('third');
  expect(await third).toBeInstanceOf(Error);
  expect(requests).toHaveLength(2);
  releases.forEach((release) => release());
  await Promise.all([first, second]);
  expect([...storage.keys()].some((key) => key.endsWith('download:third'))).toBe(false);
});

test('pause retains checkpoints, cancel clears them, and account switches never publish', async () => {
  const { pauseDownload, cancelDownload } = await import('./native-download.native');
  downloadSize = 4 * 1024 * 1024 + 12;
  interruptAfter = 1;
  await expect(downloadProductAudio('pause', downloadSize)).rejects.toThrow();
  interruptAfter = 0;
  holdRequests = true;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  onRequest = started;
  const resumed = downloadProductAudio('pause', downloadSize).catch((error) => error);
  await requestStarted;
  await pauseDownload('pause');
  const { DownloadInterrupted } = await import('./download-interrupted');
  expect(await resumed).toBeInstanceOf(DownloadInterrupted);
  expect([...files.entries()].find(([uri]) => uri.endsWith('.part'))?.[1]).toBe(4 * 1024 * 1024);
  await cancelDownload('pause');
  expect(files.size).toBe(0);
  holdRequests = false;
  onToken = () => {
    setStorageUserID('other-reader');
  };
  await expect(productEPUBSource('account-switch', 12)).rejects.toThrow('original account');
  expect(files.size).toBe(0);
  expect(requests).toHaveLength(3);
});

test('a process restart uses only the persisted checkpoint and rejects a torn append', async () => {
  downloadSize = 4 * 1024 * 1024 + 12;
  interruptAfter = 1;
  await expect(downloadProductAudio('restart', downloadSize)).rejects.toThrow();
  const partial = [...files.keys()].find((uri) => uri.endsWith('.part'))!;
  files.set(partial, files.get(partial)! + 1);
  interruptAfter = 0;
  requests = [];
  const uri = await downloadProductAudio('restart', downloadSize);
  expect(requests[0]).toBe('bytes=0-4194303');
  expect(contents.get(uri)).toEqual(sourceBytes(0, downloadSize));
});

function offlineFixture() {
  return {
    work: { id: 'paired-work', title: 'Family book', library_id: 'library' },
    epubs: [
      {
        id: 'paired-epub',
        size_bytes: 12,
        sha256: 'ebook-hash',
        representation: { id: 'epub-representation', kind: 'epub' },
      },
    ],
    audio: [
      {
        id: 'paired-audio',
        size_bytes: 12,
        sha256: 'audio-hash',
        representation: { id: 'audio-representation', kind: 'audio' },
      },
    ],
    jobs: [],
    epub_id: 'paired-epub',
    audio_id: 'paired-audio',
    progress: null,
    epub_state: null,
    audio_state: null,
    audio_chapters: {},
  } as unknown as Omit<import('./offline-library.native').OfflineWork, 'downloaded_at'>;
}

test('formats download independently, adding the other preserves saved files, and removal is selective', async () => {
  const { downloadOfflineWork, offlineWork, removeOfflineWork } =
    await import('./offline-library.native');
  const value = offlineFixture();
  await downloadOfflineWork({ ...value, audio: [] });
  expect(requests).toHaveLength(1);
  expect((await offlineWork(value.work.id))?.audio).toEqual([]);
  expect([...files.keys()].every((uri) => uri.endsWith('.epub'))).toBe(true);

  await downloadOfflineWork({ ...value, epubs: [] });
  expect(requests).toHaveLength(2);
  expect((await offlineWork(value.work.id))?.epubs).toHaveLength(1);
  expect((await offlineWork(value.work.id))?.audio).toHaveLength(1);

  await removeOfflineWork(value.work.id, 'epub');
  expect((await offlineWork(value.work.id))?.epubs).toEqual([]);
  expect((await offlineWork(value.work.id))?.audio).toHaveLength(1);
  expect([...files.keys()].some((uri) => uri.endsWith('.epub'))).toBe(false);

  await downloadOfflineWork({ ...value, audio: [] });
  expect(requests).toHaveLength(3);
  await removeOfflineWork(value.work.id, 'audio');
  expect((await offlineWork(value.work.id))?.audio).toEqual([]);
  expect([...files.keys()].every((uri) => uri.endsWith('.epub'))).toBe(true);
  await removeOfflineWork(value.work.id, 'epub');
  expect(await offlineWork(value.work.id)).toBeNull();
  expect(files.size).toBe(0);
});

test('paired failure preserves completed bytes, keeps work unavailable, and retries without redownloading', async () => {
  const { downloadOfflineWork, offlineWork, removeOfflineWork } =
    await import('./offline-library.native');
  failingMedia = 'paired-audio';
  const value = offlineFixture();
  await expect(downloadOfflineWork(value)).rejects.toThrow('Connection lost');
  expect(await offlineWork(value.work.id)).toBeNull();
  expect([...files.entries()].find(([uri]) => uri.endsWith('.epub'))?.[1]).toBe(12);
  expect([...storage.keys()].some((key) => key.includes('offline-pending:'))).toBe(true);
  failingMedia = '';
  requests = [];
  await downloadOfflineWork(value);
  expect(requests).toHaveLength(1);
  expect(await offlineWork(value.work.id)).not.toBeNull();
  await productEPUBSource('paired-epub', 12);
  const savedTransfer = [...storage.entries()].find(([key]) =>
    key.endsWith('download:paired-epub'),
  )!;
  expect(JSON.parse(savedTransfer[1]).workID).toBe(value.work.id);
  expect(JSON.parse(savedTransfer[1]).sha256).toBe('ebook-hash');
  await removeOfflineWork(value.work.id);
  expect(files.size).toBe(0);
  expect([...storage.keys()].some((key) => key.includes('download:'))).toBe(false);
});

test('removing a running pair waits for its owner and cannot resurrect offline data', async () => {
  const { downloadOfflineWork, removeOfflineWork, offlineWork } =
    await import('./offline-library.native');
  holdRequests = true;
  let started!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  onRequest = () => {
    if (requests.length === 2) started();
  };
  const value = offlineFixture();
  const download = downloadOfflineWork(value).catch((error) => error);
  await bothStarted;
  await removeOfflineWork(value.work.id);
  expect(await download).toBeInstanceOf(Error);
  expect(await offlineWork(value.work.id)).toBeNull();
  expect(files.size).toBe(0);
  expect(
    [...storage.keys()].some(
      (key) => key.includes('offline-pending:') || key.includes('download:'),
    ),
  ).toBe(false);
});

test('retry preserves newer pending reading state and refuses a different edition until sync', async () => {
  const { downloadOfflineWork, offlineWork, updateOfflineRepresentationState, removeOfflineWork } =
    await import('./offline-library.native');
  const value = offlineFixture();
  await downloadOfflineWork(value);
  const state = {
    representation_id: 'epub-representation',
    epub_locator: { href: 'new.xhtml' },
    revision: 4,
  } as unknown as import('@/generated/api').RepresentationState;
  await updateOfflineRepresentationState(value.work.id, 'epub', state, true);
  await downloadOfflineWork(value);
  expect((await offlineWork(value.work.id))?.epub_state?.revision).toBe(4);
  await expect(downloadOfflineWork({ ...value, epub_id: 'different-edition' })).rejects.toThrow(
    'Sync this device',
  );
  await expect(removeOfflineWork(value.work.id)).rejects.toThrow('Sync this device');
  expect((await offlineWork(value.work.id))?.epub_state?.revision).toBe(4);
});

test('native account cleanup waits for transfers and deletes only its own files and manifests', async () => {
  const { clearStorageScope } = await import('./storage-scope.native');
  const { downloadOfflineWork } = await import('./offline-library.native');
  const other = 'file:///documents/aldus-another-account-media.epub';
  files.set(other, 7);
  storage.set('aldus:another-account:offline-work:book', '{}');
  holdRequests = true;
  let started!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  onRequest = () => {
    if (requests.length === 2) started();
  };
  const download = downloadOfflineWork(offlineFixture()).catch((error) => error);
  await bothStarted;
  await clearStorageScope('http://localhost:8080', 'reader');
  expect(await download).toBeInstanceOf(Error);
  expect([...files.keys()]).toEqual([other]);
  expect([...storage.keys()]).toEqual(['aldus:another-account:offline-work:book']);
});

test('416, oversized full responses and changed known hashes cannot publish a destination', async () => {
  responseStatus = 416;
  await expect(productEPUBSource('range416', 12)).rejects.toThrow('invalid');
  responseStatus = 200;
  downloadSize = 13;
  await expect(productEPUBSource('oversized', 12)).rejects.toThrow('exceeded its expected size');
  expect(files.size).toBe(0);
  downloadSize = 12;
  await productEPUBSource('changed', 12, 'original-hash');
  responseStatus = 416;
  await expect(productEPUBSource('changed', 12, 'new-hash')).rejects.toThrow('invalid');
  expect(files.size).toBe(0);
});

test('a reading update queued during final manifest publication cannot be overwritten', async () => {
  const { downloadOfflineWork, offlineWork, updateOfflineRepresentationState } =
    await import('./offline-library.native');
  const value = offlineFixture();
  await downloadOfflineWork(value);
  let release!: () => void;
  let entered!: () => void;
  const publication = new Promise<void>((resolve) => {
    entered = resolve;
  });
  onWrite = async (key) => {
    if (!key.includes('offline-work:')) return;
    onWrite = async () => {};
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const retry = downloadOfflineWork(value);
  await publication;
  const state = {
    representation_id: 'epub-representation',
    epub_locator: { href: 'latest.xhtml' },
    revision: 8,
  } as unknown as import('@/generated/api').RepresentationState;
  const updated = updateOfflineRepresentationState(value.work.id, 'epub', state, true);
  release();
  await Promise.all([retry, updated]);
  const saved = await offlineWork(value.work.id);
  expect(saved?.epub_state?.revision).toBe(8);
  expect(saved?.pending_representation_states?.epub).toBe(true);
});

test('retry preserves pending exact progress with the same timestamp and an absent server position', async () => {
  const { downloadOfflineWork, offlineWork, updateOfflineProgress } =
    await import('./offline-library.native');
  const { activeStorageScope, scopedStorageKey } = await import('./storage-scope');
  const value = offlineFixture();
  value.alignment = { id: 'alignment' } as import('@/generated/api').Alignment;
  const remote = {
    alignment_id: 'alignment',
    segment_id: 'old',
    revision: 3,
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as import('@/generated/api').CanonicalPosition;
  value.progress = remote;
  await downloadOfflineWork(value);
  const local = { ...remote, segment_id: 'new' };
  await updateOfflineProgress(value.work.id, local);
  storage.set(
    scopedStorageKey(`progress-outbox:${value.work.id}`, activeStorageScope()),
    JSON.stringify({ alignment_id: 'alignment', segment_id: 'new' }),
  );
  await downloadOfflineWork(value);
  expect((await offlineWork(value.work.id))?.progress).toEqual(local);
  await downloadOfflineWork({ ...value, progress: null });
  expect((await offlineWork(value.work.id))?.progress).toEqual(local);
});

test('a server switch during a native request cannot publish or write to the new scope', async () => {
  holdRequests = true;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  onRequest = started;
  const pending = productEPUBSource('switch-in-flight', 12).catch((error) => error);
  await requestStarted;
  setAPIBaseURL('http://localhost:8081');
  releases.forEach((release) => release());
  expect(await pending).toBeInstanceOf(Error);
  expect(files.size).toBe(0);
  expect([...storage.keys()].some((key) => key.includes('8081'))).toBe(false);
});

test('authentication and server errors retain verified bytes for an offset retry', async () => {
  downloadSize = 4 * 1024 * 1024 + 12;
  interruptAfter = 1;
  await expect(downloadProductAudio('retry-server', downloadSize)).rejects.toThrow(
    'Connection lost',
  );
  interruptAfter = 0;
  for (const status of [401, 403, 500, 503]) {
    responseStatus = status;
    await expect(downloadProductAudio('retry-server', downloadSize)).rejects.toThrow();
    expect([...files.entries()].find(([uri]) => uri.endsWith('.part'))?.[1]).toBe(4 * 1024 * 1024);
  }
  responseStatus = 206;
  const uri = await downloadProductAudio('retry-server', downloadSize);
  expect(requests.at(-1)).toBe(`bytes=4194304-${downloadSize - 1}`);
  expect(contents.get(uri)).toEqual(sourceBytes(0, downloadSize));
});

test('oversized native progress fails visibly and clears a retained prefix before response validation', async () => {
  const { DownloadInterrupted } = await import('./download-interrupted');
  progressBytes = 13;
  const fresh = await productEPUBSource('oversized-progress-fresh', 12).catch((error) => error);
  expect(fresh).not.toBeInstanceOf(DownloadInterrupted);
  expect(fresh.message).toContain('exceeded its expected size');
  expect(files.size).toBe(0);

  progressBytes = undefined;
  downloadSize = 4 * 1024 * 1024 + 12;
  interruptAfter = requests.length + 1;
  await expect(downloadProductAudio('oversized-progress-prefix', downloadSize)).rejects.toThrow(
    'Connection lost',
  );
  expect([...files.entries()].find(([uri]) => uri.endsWith('.part'))?.[1]).toBe(4 * 1024 * 1024);
  interruptAfter = 0;
  progressBytes = downloadSize + 1;
  const resumed = await downloadProductAudio('oversized-progress-prefix', downloadSize).catch(
    (error) => error,
  );
  expect(resumed).not.toBeInstanceOf(DownloadInterrupted);
  expect(resumed.message).toContain('exceeded its expected size');
  expect(files.size).toBe(0);
  const raw = [...storage.entries()].find(([key]) =>
    key.endsWith('download:oversized-progress-prefix'),
  )![1];
  const saved = JSON.parse(raw);
  expect(saved.status).toBe('failed');
  expect(saved.error).toContain('exceeded its expected size');
  expect(saved.bytes).toBe(0);
});

test('cookie-authenticated native transport works without SecureStore bearer and missing credentials reach HTTP401', async () => {
  token = null;
  cookieAuthenticated = true;
  const epub = await productEPUBSource('cookie-authenticated', 12);
  expect(files.get(epub)).toBe(12);
  expect(requestHeaders[0]).toEqual({ Range: 'bytes=0-11' });
  expect(
    [...storage.values()].some(
      (value) => value.includes('Authorization') || value.includes('Cookie'),
    ),
  ).toBe(false);

  cookieAuthenticated = false;
  await expect(productEPUBSource('unauthenticated', 12)).rejects.toThrow(
    'Sign in to the original account',
  );
  expect(requests).toHaveLength(2);
  expect(requestHeaders[1]).toEqual({ Range: 'bytes=0-11' });
  expect([...files.keys()].some((uri) => uri.includes('unauthenticated'))).toBe(false);
});

test('missing server media reports source recovery instructions', async () => {
  responseStatus = 404;
  await expect(productEPUBSource('missing-source', 12)).rejects.toThrow(
    'check the source folder and rescan',
  );
  expect([...files.keys()].some((uri) => uri.includes('missing-source'))).toBe(false);
});
