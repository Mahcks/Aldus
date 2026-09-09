import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const storage = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    getAllKeys: async () => [...storage.keys()],
  },
}));
mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
mock.module('expo-file-system/legacy', () => ({
  createDownloadResumable: () => {},
  FileSystemSessionType: { FOREGROUND: 0 },
}));
mock.module('expo-file-system', () => ({
  File: class {
    exists = true;
    size = 0;
    delete() {}
  },
  Paths: { document: 'file:///documents/' },
}));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const {
  acknowledgeOfflineRepresentationState,
  offlineWork,
  reconcileOfflineRepresentationStates,
  updateOfflineRepresentationState,
} = await import('./offline-library.native');
const { serverStorageScope } = await import('./server-origin');
const { setStorageUserID } = await import('./storage-scope');
const originalAPIBaseURL = getAPIBaseURL();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  storage.clear();
  setAPIBaseURL('http://localhost:8080');
  setStorageUserID('reader-one');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setAPIBaseURL(originalAPIBaseURL);
  setStorageUserID('');
});

test('offline representation sync stops when the server or account changes', async () => {
  const oldScope = serverStorageScope('http://localhost:8080', 'reader-one');
  const oldKey = `aldus:${oldScope}:offline-work:work`;
  storage.set(
    oldKey,
    JSON.stringify({
      work: { id: 'work', library_id: 'library' },
      epubs: [],
      audio: [],
      jobs: [],
      epub_id: '',
      audio_id: '',
      progress: null,
      epub_state: {
        representation_id: 'representation',
        epub_locator: { href: 'chapter.xhtml' },
        revision: 1,
        updated_at: '2026-01-01T00:00:00Z',
      },
      audio_state: null,
      pending_representation_states: { epub: true },
      audio_chapters: {},
      downloaded_at: '2026-01-01T00:00:00Z',
    }),
  );

  let releaseRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    globalThis.fetch = (async () => {
      resolve();
      await new Promise<void>((release) => {
        releaseRequest = release;
      });
      return Response.json({
        representation_id: 'representation',
        revision: 2,
        updated_at: '2026-01-01T00:01:00Z',
      });
    }) as unknown as typeof fetch;
  });

  const reconciliation = reconcileOfflineRepresentationStates();
  await requestStarted;
  setAPIBaseURL('http://localhost:8081');
  setStorageUserID('reader-two');
  releaseRequest();
  await reconciliation;

  expect(JSON.parse(storage.get(oldKey) ?? '{}').pending_representation_states.epub).toBe(true);
  expect([...storage.keys()].some((key) => key.includes('reader-two'))).toBe(false);
});

test('foreground representation sync does nothing without an active account', async () => {
  setStorageUserID('');
  await expect(reconcileOfflineRepresentationStates()).resolves.toEqual([]);
  expect(storage.size).toBe(0);
});

test('reading an offline book without an account returns no cached book', async () => {
  setStorageUserID('');
  await expect(offlineWork('work')).resolves.toBeNull();
});

function queueEdition(kind: 'epub' | 'audio' = 'epub') {
  const scope = serverStorageScope('http://localhost:8080', 'reader-one');
  const state = {
    representation_id: 'representation',
    revision: 4,
    updated_at: '2026-01-01T00:00:00Z',
    ...(kind === 'epub'
      ? { epub_locator: { href: 'chapter-2.xhtml' } }
      : { audio_timestamp_ms: 120000, playback_speed: 1 }),
  };
  storage.set(
    `aldus:${scope}:offline-work:work`,
    JSON.stringify({
      work: { id: 'work', library_id: 'library' },
      epubs: [],
      audio: [],
      jobs: [],
      epub_id: '',
      audio_id: '',
      progress: null,
      epub_state: kind === 'epub' ? state : null,
      audio_state: kind === 'audio' ? state : null,
      pending_representation_states: { [kind]: true },
      audio_chapters: {},
      downloaded_at: '2026-01-01T00:00:00Z',
    }),
  );
  return state;
}

for (const kind of ['epub', 'audio'] as const) {
  test(`${kind} offline replay preserves remote conflict and keeps local state queued`, async () => {
    const local = queueEdition(kind);
    const remote = { ...local, revision: 5, updated_at: '2026-01-02T00:00:00Z' };
    const writes: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(init.body as string));
        return Response.json({ error: 'revision_conflict' }, { status: 409 });
      }
      return Response.json(remote);
    }) as typeof fetch;
    expect(await reconcileOfflineRepresentationStates()).toEqual([
      { workID: 'work', kind, local, remote },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ expected_revision: 4 });
    const stored = await offlineWork('work');
    expect(stored?.pending_representation_states?.[kind]).toBe(true);
    expect(kind === 'epub' ? stored?.epub_state : stored?.audio_state).toEqual(local);
  });
}

test('late replay response retains a newer local edit and rebases it on the successful write', async () => {
  const local = queueEdition();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  globalThis.fetch = (async (_input, init) => {
    writes += 1;
    const update = JSON.parse(init?.body as string);
    started();
    await response;
    return Response.json({ ...local, ...update, revision: update.expected_revision + 1 });
  }) as typeof fetch;
  const replay = reconcileOfflineRepresentationStates();
  await ready;
  const newer = { ...local, epub_locator: { href: 'chapter-3.xhtml' } };
  await updateOfflineRepresentationState('work', 'epub', newer, true);
  const duplicate = reconcileOfflineRepresentationStates();
  release();
  await Promise.all([replay, duplicate]);
  expect(writes).toBe(1);
  const stored = await offlineWork('work');
  expect(stored?.epub_state?.epub_locator).toEqual(newer.epub_locator);
  expect(stored?.epub_state?.revision).toBe(5);
  expect(stored?.pending_representation_states?.epub).toBe(true);
  await reconcileOfflineRepresentationStates();
  expect((await offlineWork('work'))?.pending_representation_states?.epub).toBe(false);
  expect((await offlineWork('work'))?.epub_state?.epub_locator).toEqual(newer.epub_locator);
});

test('accepting a server conflict never rebases a different newer local edit', async () => {
  const submitted = queueEdition();
  const newer = { ...submitted, epub_locator: { href: 'chapter-4.xhtml' } };
  await updateOfflineRepresentationState('work', 'epub', newer, true);
  const remote = { ...submitted, revision: 9, epub_locator: { href: 'chapter-8.xhtml' } };
  await acknowledgeOfflineRepresentationState('work', 'epub', submitted, remote, false);
  expect((await offlineWork('work'))?.epub_state).toEqual(newer);
  expect((await offlineWork('work'))?.pending_representation_states?.epub).toBe(true);
});

test('a failed replay keeps its expected revision and local position for retry', async () => {
  const local = queueEdition();
  globalThis.fetch = (async () =>
    Response.json({ error: 'unavailable' }, { status: 503 })) as unknown as typeof fetch;
  expect(await reconcileOfflineRepresentationStates()).toEqual([]);
  expect((await offlineWork('work'))?.epub_state).toEqual(local);
  expect((await offlineWork('work'))?.pending_representation_states?.epub).toBe(true);
});
