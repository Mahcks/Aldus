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
mock.module('expo-file-system', () => ({
  File: class {
    exists = true;
    size = 0;
    delete() {}
  },
  Paths: { document: 'file:///documents/' },
}));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const { reconcileOfflineRepresentationStates } = await import('./offline-library.native');
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
