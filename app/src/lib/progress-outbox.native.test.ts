import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const storage = new Map<string, string>();
let blockedIndexWrite: { started: () => void; wait: Promise<void> } | undefined;
let blockedWorkWrite: { started: () => void; wait: Promise<void> } | undefined;

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
      if (key.endsWith('offline-work:work') && blockedWorkWrite) {
        const blocked = blockedWorkWrite;
        blockedWorkWrite = undefined;
        blocked.started();
        await blocked.wait;
      }
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
mock.module('expo-file-system/legacy', () => ({
  createDownloadResumable: () => {},
  FileSystemSessionType: { FOREGROUND: 0 },
}));
mock.module('expo-file-system', () => ({
  File: class {},
  Paths: { document: 'file:///documents/' },
}));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const {
  reconcileAllPendingProgress,
  discardPendingProgress,
  pendingProgress,
  pendingProgressSnapshot,
  reconcilePendingProgress,
  saveWorkProgress,
} = await import('./progress-outbox.native');
const { activeStorageScope, setStorageUserID } = await import('./storage-scope');
const { offlineWork } = await import('./offline-library.native');
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
  blockedWorkWrite = undefined;
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
  }) as unknown as unknown as typeof fetch;
  expect(await saveWorkProgress('work', update)).toBeNull();

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    Response.json({
      ...update,
      work_id: 'work',
      revision: init?.method === 'PUT' ? 1 : 0,
      resolvable: true,
    })) as unknown as unknown as typeof fetch;

  expect(await reconcilePendingProgress('work')).toBeNull();
  expect(await pendingProgress('work')).toBeNull();
});

test('replay saves its acknowledged revision for the next offline edit', async () => {
  const workKey = `aldus:${activeStorageScope()}:offline-work:work`;
  storage.set(
    workKey,
    JSON.stringify({ work: { id: 'work' }, epubs: [], audio: [], progress: null }),
  );
  const goOffline = () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
  };
  let revision = 0;
  const goOnline = () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const submitted = JSON.parse(String(init.body));
        expect(submitted.expected_revision).toBe(revision);
        revision++;
        return Response.json({ ...submitted, work_id: 'work', revision });
      }
      return Response.json({ ...update, work_id: 'work', revision });
    }) as unknown as typeof fetch;
  };

  goOffline();
  await saveWorkProgress('work', update);
  goOnline();
  await reconcilePendingProgress('work');
  const cached = await offlineWork('work');
  expect(cached?.progress?.revision).toBe(1);
  expect(await pendingProgress('work')).toBeNull();

  goOffline();
  await saveWorkProgress('work', {
    ...update,
    offset: 700_000,
    expected_revision: cached!.progress!.revision!,
  });
  goOnline();
  expect(await reconcilePendingProgress('work')).toBeNull();
  expect((await offlineWork('work'))?.progress).toMatchObject({
    offset: 700_000,
    revision: 2,
  });
  expect(await pendingProgress('work')).toBeNull();
});

test('replay persists its cache before clearing pending progress or admitting a newer save', async () => {
  const scope = activeStorageScope();
  storage.set(
    `aldus:${scope}:offline-work:work`,
    JSON.stringify({ work: { id: 'work' }, epubs: [], audio: [], progress: null }),
  );
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  await saveWorkProgress('work', update);

  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  blockedWorkWrite = {
    started,
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    Response.json({
      ...update,
      revision: init?.method === 'PUT' ? 1 : 0,
    })) as unknown as typeof fetch;
  const replay = reconcilePendingProgress('work');
  await start;
  // The manifest queue can inspect pending progress without waiting for replay.
  expect(await pendingProgressSnapshot('work', scope)).toEqual(update);
  expect((await offlineWork('work'))?.progress).toBeNull();
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const newer = { ...update, offset: 800_000, expected_revision: 1 };
  const save = saveWorkProgress('work', newer);
  release();
  await replay;
  expect(await save).toBeNull();
  expect((await offlineWork('work'))?.progress?.revision).toBe(1);
  expect(await pendingProgress('work')).toEqual(newer);
});

test('pending progress is not submitted after the active account changes', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as unknown as typeof fetch;
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
    }) as unknown as unknown as typeof fetch;
  });

  const reconciliation = reconcilePendingProgress('work');
  await requestStarted;
  setStorageUserID('reader-two');
  releaseRequest();

  await expect(reconciliation).rejects.toThrow('server or account changed');
  expect(await pendingProgress('work', oldScope)).toEqual(update);

  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as unknown as typeof fetch;
  expect(await saveWorkProgress('later', update)).toBeNull();
  expect(await pendingProgress('later')).toEqual(update);
});

test('overlapping saves retain every indexed work', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as unknown as typeof fetch;
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
  }) as unknown as unknown as typeof fetch;
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

test('foreground progress sync does nothing without an active account', async () => {
  setStorageUserID('');
  await expect(reconcileAllPendingProgress()).resolves.toBeUndefined();
  expect(storage.size).toBe(0);
});

test('a save waiting in the queue keeps its original reader after account switching', async () => {
  const blocked = deferNextIndexWrite();
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
  const first = saveWorkProgress('first', update).catch((error: unknown) => error);
  await blocked.started;
  const oldScope = activeStorageScope();
  const second = saveWorkProgress('second', update);
  const rejected = second.catch((error: unknown) => error);
  setStorageUserID('reader-two');
  let sent = 0;
  globalThis.fetch = (async () => {
    sent++;
    return Response.json({ ...update, revision: 1 });
  }) as unknown as typeof fetch;
  blocked.release();
  expect(((await first) as Error).message).toContain('original reader');
  expect(((await rejected) as Error).message).toContain('original reader');
  expect(sent).toBe(0);
  expect(await pendingProgress('second', oldScope)).toEqual(update);
  expect(await pendingProgress('second')).toBeNull();
});

test('progress is durable before the network responds and survives a failed request', async () => {
  const scope = activeStorageScope();
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async () => {
    started();
    await response;
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }) as unknown as typeof fetch;
  const saving = saveWorkProgress('work', update);
  const failure = saving.catch((error: unknown) => error);
  await requestStarted;
  expect(await pendingProgressSnapshot('work', scope)).toEqual(update);
  expect(indexedWorkIDs()).toEqual(['work']);
  release();
  expect(await failure).toBeInstanceOf(Error);
  expect(await pendingProgress('work')).toEqual(update);
});
