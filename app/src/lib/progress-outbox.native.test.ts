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
    getAllKeys: async () => [...storage.keys()],
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

test('offline replay keeps the originating ownership epoch and retains a superseded save', async () => {
  const { registerReadingProof, clearReadingProof } = await import('./consumption/reading-proof');
  try {
    registerReadingProof('work', { device_id: 'phone', epoch: 4 });
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await saveWorkProgress('work', update);
    expect((await pendingProgress('work'))?.ownership).toEqual({ device_id: 'phone', epoch: 4 });

    registerReadingProof('work', { device_id: 'phone', epoch: 6 });
    let sent: any;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ code: 'ownership_superseded', owner: null }), {
          status: 409,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    expect(await reconcilePendingProgress('work')).toEqual({
      local: { ...update, ownership: { device_id: 'phone', epoch: 4 } },
      remote: null,
    });
    expect(sent.ownership).toEqual({ device_id: 'phone', epoch: 4 });
    expect((await pendingProgress('work'))?.ownership).toEqual({ device_id: 'phone', epoch: 4 });
  } finally {
    clearReadingProof('work');
  }
});

test('offline reading credentials remain scoped to their original account and server', async () => {
  const { cacheReadingProof, cachedReadingProof } =
    await import('./consumption/reading-proof-cache');
  await cacheReadingProof('work', { device_id: 'phone', epoch: 4 });
  expect(await cachedReadingProof('work')).toEqual({ device_id: 'phone', epoch: 4 });
  setStorageUserID('reader-two');
  expect(await cachedReadingProof('work')).toBeUndefined();
  setStorageUserID('reader-one');
  setAPIBaseURL('http://other-server:8080');
  expect(await cachedReadingProof('work')).toBeUndefined();
});

test('unresolved choices survive reopening and remain account/server scoped', async () => {
  const { rememberReadingConflict, savedReadingConflicts } =
    await import('./consumption/reading-conflict');
  const conflict = {
    local: { alignment_id: 'alignment', segment_id: 'local', offset: 5 },
    remote: { alignment_id: 'alignment', segment_id: 'remote', offset: 10, revision: 2 },
  };
  await rememberReadingConflict('work', 'progress', conflict);
  expect((await savedReadingConflicts('work')).progress).toEqual(conflict);
  setStorageUserID('reader-two');
  expect(await savedReadingConflicts('work')).toEqual({});
  setStorageUserID('reader-one');
  setAPIBaseURL('http://other-server:8080');
  expect(await savedReadingConflicts('work')).toEqual({});
  setAPIBaseURL('http://localhost:8080');
  expect((await savedReadingConflicts('work')).progress).toEqual(conflict);
  await rememberReadingConflict('work', 'progress', undefined);
  expect(await savedReadingConflicts('work')).toEqual({});
});

test('concurrent native identity requests use the same persisted installation ID', async () => {
  const { getDeviceIdentity } = await import('./device-identity.native');
  const [first, second] = await Promise.all([getDeviceIdentity(), getDeviceIdentity()]);
  expect(first).toEqual(second);
  expect(first.deviceID).toBe(storage.get('aldus:device-id')!);
});

test('web edition replay shares one request and keeps a rejected position when the server has none', async () => {
  const web = await import('./representation-outbox.web');
  const local = {
    representation_id: 'epub',
    revision: 0,
    epub_locator: '{"href":"chapter.xhtml"}',
  } as import('@/generated/api').RepresentationState;
  const proof = { device_id: 'old-device', epoch: 1 };
  await web.updateOfflineRepresentationState(
    'work',
    'epub',
    local,
    true,
    activeStorageScope(),
    proof,
  );
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let puts = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts++;
      expect(JSON.parse(String(init.body)).ownership).toEqual(proof);
      started();
      await blocked;
      return new Response('conflict', { status: 409 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const first = web.reconcileOfflineRepresentationStates('work');
  await began;
  const second = web.reconcileOfflineRepresentationStates('work');
  await flushPromises();
  release();
  const results = await Promise.all([first, second]);
  expect(puts).toBe(1);
  for (const conflicts of results)
    expect(conflicts).toEqual([{ workID: 'work', kind: 'epub', local, remote: null }]);
  const queued = [...storage.values()]
    .map((value) => JSON.parse(value))
    .find((value) => value.local);
  expect(queued.local).toEqual(local);
  expect(queued.ownership).toEqual(proof);
  await web.acknowledgeOfflineRepresentationState('work', 'epub', local, null, false);
  expect([...storage.keys()].filter((key) => key.includes('edition-outbox:'))).toHaveLength(0);
});

test('reconnect replay waits for a foreground edition acknowledgment instead of resubmitting it', async () => {
  const web = await import('./representation-outbox.web');
  const { serializeEditionSave } = await import('./consumption/offline-representation');
  const local = {
    representation_id: 'epub',
    revision: 3,
    epub_locator: '{"href":"chapter.xhtml"}',
  } as import('@/generated/api').RepresentationState;
  const saved = { ...local, revision: 4 };
  let release!: () => void;
  let staged!: () => void;
  const started = new Promise<void>((resolve) => {
    staged = resolve;
  });
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const foreground = serializeEditionSave('work', async () => {
    await web.updateOfflineRepresentationState('work', 'epub', local, true);
    staged();
    await response;
    await web.acknowledgeOfflineRepresentationState('work', 'epub', local, saved);
  });
  await started;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response('unexpected replay', { status: 409 });
  }) as unknown as typeof fetch;
  const replay = web.reconcileOfflineRepresentationStates('work');
  await flushPromises();
  expect(requests).toBe(0);
  release();
  await foreground;
  expect(await replay).toEqual([]);
  expect(requests).toBe(0);
  expect(await web.offlineRepresentationState('work', 'epub')).toEqual(saved);
});
