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
  },
}));
mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const { pendingProgress, reconcilePendingProgress, saveWorkProgress } =
  await import('./progress-outbox.native');
const { activeStorageScope, setStorageUserID } = await import('./storage-scope');
const originalAPIBaseURL = getAPIBaseURL();
const originalFetch = globalThis.fetch;

const update = {
  alignment_id: 'alignment',
  segment_id: 'segment',
  offset: 500_000,
  expected_revision: 0,
  source_device: 'ios',
};

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

test('pending progress is not submitted after the active account changes', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  expect(await saveWorkProgress('work', update)).toBeNull();
  const oldScope = activeStorageScope();

  let releaseRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    globalThis.fetch = (async () => {
      resolve();
      await new Promise<void>((release) => {
        releaseRequest = release;
      });
      return Response.json({ ...update, work_id: 'work', revision: 0 });
    }) as unknown as typeof fetch;
  });

  const reconciliation = reconcilePendingProgress('work');
  await requestStarted;
  setStorageUserID('reader-two');
  releaseRequest();

  await expect(reconciliation).rejects.toThrow('server or account changed');
  expect(await pendingProgress('work', oldScope)).toEqual(update);
});
