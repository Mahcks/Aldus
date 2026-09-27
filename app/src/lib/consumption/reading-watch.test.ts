import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('./reading-watch.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

class APIError extends Error {
  constructor(
    public status: number,
    public retryAfterMS?: number,
  ) {
    super('request failed');
  }
}
const proof = { device_id: 'phone', epoch: 3 };
const other = { device_id: 'web', epoch: 4 };
function harness(watch: (...args: any[]) => Promise<unknown>, retryDelays?: number[]) {
  const lost: unknown[][] = [];
  const controller = new AbortController();
  let scope = 'account-one';
  const exports: any = {};
  const dependencies: Record<string, unknown> = {
    '@/lib/api': { api: { watchReadingSession: watch }, APIError },
    './reading-proof': { reportOwnershipLost: (...args: unknown[]) => lost.push(args) },
    '@/lib/storage-scope': { activeStorageScope: () => scope },
    '@/lib/api-base': { getAPIBaseURL: () => 'server' },
  };
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', source)(
    (name: string) => dependencies[name],
    exports,
    retryDelays
      ? (callback: () => void, ms: number) => {
          retryDelays.push(ms);
          queueMicrotask(callback);
          return 0;
        }
      : setTimeout,
    retryDelays ? () => {} : clearTimeout,
  );
  return {
    lost,
    controller,
    switchAccount: () => {
      scope = 'account-two';
    },
    run: () => exports.watchReadingOwnership('book', proof, controller.signal),
  };
}

test('watch pauses the captured proof on takeover, without polling again', async () => {
  let requests = 0;
  const h = harness(async () => {
    requests++;
    return other;
  });
  await h.run();
  expect(requests).toBe(1);
  expect(h.lost).toEqual([['book', other, proof]]);
});

for (const reason of ['abort', 'account']) {
  test(`late watch response ignored after ${reason}`, async () => {
    let resolve!: (value: unknown) => void;
    const h = harness(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = h.run();
    if (reason === 'abort') h.controller.abort();
    else h.switchAccount();
    resolve(other);
    await pending;
    expect(h.lost).toEqual([]);
  });
}

test('unchanged timeout reissues sequentially and detects the next takeover', async () => {
  let calls = 0;
  const h = harness(async () => (++calls === 1 ? proof : other));
  await h.run();
  expect(calls).toBe(2);
  expect(h.lost).toHaveLength(1);
});

for (const status of [401, 403, 404, 409]) {
  test(`watch stops on HTTP ${status} without granting or revoking a proof`, async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new APIError(status);
    });
    await h.run();
    expect(calls).toBe(1);
    expect(h.lost).toEqual([]);
  });
}

test('offline retry can be cancelled immediately without dropping local state', async () => {
  let failed!: () => void;
  const failure = new Promise<void>((resolve) => {
    failed = resolve;
  });
  let calls = 0;
  const h = harness(async () => {
    calls++;
    failed();
    throw new APIError(0);
  });
  const pending = h.run();
  await failure;
  // Let the rejection install its retry before cancelling.
  await Promise.resolve();
  h.controller.abort();
  await pending;
  expect(calls).toBe(1);
  expect(h.lost).toEqual([]);
});

test('reconnect after transport failure reads current owner and honors server retry delay', async () => {
  let calls = 0;
  const delays: number[] = [];
  const h = harness(async () => {
    calls++;
    if (calls === 1) throw new APIError(0);
    if (calls === 2) throw new APIError(429, 15000);
    return other;
  }, delays);
  await h.run();
  expect(calls).toBe(3);
  expect(delays[0]).toBeGreaterThanOrEqual(750);
  expect(delays[1]).toBe(15000);
  expect(h.lost).toEqual([['book', other, proof]]);
});

test('native session cancels in background, reconnects on foreground, and cleans up', () => {
  const hook = ts.createSourceFile(
    'hook.ts',
    readFileSync(new URL('../../hooks/consumption/useReadingSession.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function find(node: ts.Node): ts.CallExpression | undefined {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(hook) === 'useEffect' &&
      node.getText(hook).includes('void watchReadingOwnership(')
    )
      return node;
    return ts.forEachChild(node, find);
  }
  const effect = ts.transpileModule(find(hook)!.getText(hook), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let cleanup!: () => void;
  let change!: () => void;
  let removed = false;
  const signals: AbortSignal[] = [];
  const appState = {
    currentState: 'active',
    addEventListener: (_: string, callback: () => void) => {
      change = callback;
      return {
        remove: () => {
          removed = true;
        },
      };
    },
  };
  new Function(
    'useEffect',
    'AppState',
    'Platform',
    'watchReadingOwnership',
    'watchedDeviceID',
    'watchedEpoch',
    'workID',
    'const observingOwner = false; ' + effect,
  )(
    (run: () => () => void) => {
      cleanup = run();
    },
    appState,
    { OS: 'ios' },
    (_: string, __: unknown, signal: AbortSignal) => {
      signals.push(signal);
    },
    'phone',
    3,
    'book',
  );
  expect(signals).toHaveLength(1);
  appState.currentState = 'background';
  change();
  expect(signals[0].aborted).toBe(true);
  expect(signals).toHaveLength(1);
  appState.currentState = 'active';
  change();
  expect(signals).toHaveLength(2);
  expect(signals[1].aborted).toBe(false);
  cleanup();
  expect(signals[1].aborted).toBe(true);
  expect(removed).toBe(true);
});
