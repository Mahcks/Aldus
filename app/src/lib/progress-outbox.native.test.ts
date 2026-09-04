import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const storage = new Map<string, string>();
let blockedIndexWrite: { started: () => void; wait: Promise<void> } | undefined;

function deferNextIndexWrite() {
  let started!: () => void;
  let release!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  blockedIndexWrite = { started, wait };
  return { started: startedPromise, release };
}

async function flushPromises() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

function indexedWorkIDs() {
  const entry = [...storage].find(([key]) => key.endsWith('progress-outbox:index'));
  return entry ? (JSON.parse(entry[1]) as string[]) : [];
}

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (key.endsWith('progress-outbox:index') && blockedIndexWrite) {
        const blocked = blockedIndexWrite;
        blockedIndexWrite = undefined;
        blocked.started();
        await blocked.wait;
      }
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
}));
mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const { discardPendingProgress, pendingProgress, reconcilePendingProgress, saveWorkProgress } =
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
  blockedIndexWrite = undefined;
  setAPIBaseURL('http://localhost:8080');
  setStorageUserID('reader-one');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setAPIBaseURL(originalAPIBaseURL);
  setStorageUserID('');
});

test('reconciles queued progress and removes it from the outbox', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  expect(await saveWorkProgress('work', update)).toBeNull();

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    Response.json({
      ...update,
      work_id: 'work',
      revision: init?.method === 'PUT' ? 1 : 0,
      resolvable: true,
    })) as unknown as typeof fetch;

  expect(await reconcilePendingProgress('work')).toBeNull();
  expect(await pendingProgress('work')).toBeNull();
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

  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  expect(await saveWorkProgress('later', update)).toBeNull();
  expect(await pendingProgress('later')).toEqual(update);
});

test('overlapping saves retain every indexed work', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const blocked = deferNextIndexWrite();
  const first = saveWorkProgress('one', update);
  await blocked.started;
  const second = saveWorkProgress('two', update);
  await flushPromises();
  blocked.release();
  await Promise.all([first, second]);

  expect(new Set(indexedWorkIDs())).toEqual(new Set(['one', 'two']));
});

test('a new save cannot be unindexed by overlapping discard', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  await saveWorkProgress('work', update);

  const blocked = deferNextIndexWrite();
  const discard = discardPendingProgress('work');
  await blocked.started;
  const next = { ...update, offset: 700_000 };
  const save = saveWorkProgress('work', next);
  await flushPromises();
  blocked.release();
  await Promise.all([discard, save]);

  expect(indexedWorkIDs()).toEqual(['work']);
  expect(await pendingProgress('work')).toEqual(next);
});
