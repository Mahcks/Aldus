import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readingSessionReducer, type SessionState, type SessionEvent } from './reading-session';

const file = ts.createSourceFile(
  'hook.ts',
  readFileSync(new URL('../../hooks/consumption/useReadingSession.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
function find(node: ts.Node): ts.FunctionDeclaration | undefined {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'refreshForeground') return node;
  return ts.forEachChild(node, find);
}
const source = ts.transpileModule(find(file)!.getText(file), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
class APIError extends Error {
  constructor(public status: number) {
    super('request failed');
  }
}
class OwnershipSupersededError extends Error {
  owner = null;
}

for (const outcome of ['owned', 'offline', 'superseded', 'server-error', 'cancelled']) {
  test(`foreground input is blocked before the network returns: ${outcome}`, async () => {
    const proof = { device_id: 'phone', epoch: 4 };
    const stateRef: { current: SessionState } = { current: { kind: 'active', proof, attempt: 1 } };
    const blocked = { current: false };
    let paused = false;
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const dispatch = (event: SessionEvent) => {
      stateRef.current = readingSessionReducer(stateRef.current, event);
    };
    const api = {
      refreshReadingSession: async () => {
        await pending;
        if (outcome === 'offline') throw new APIError(0);
        if (outcome === 'superseded') throw new OwnershipSupersededError();
        if (outcome === 'server-error') throw new APIError(500);
      },
    };
    const harness = new Function(
      'stateRef',
      'foregroundBlocked',
      'api',
      'APIError',
      'OwnershipSupersededError',
      'dispatch',
      'pauseReadingProof',
      'reportOwnershipLost',
      'AppState',
      `let cancelled=false, foregroundAttempt=0; const workID='work'; ${source}; return {run:refreshForeground,cancel:()=>{cancelled=true}};`,
    )(
      stateRef,
      blocked,
      api,
      APIError,
      OwnershipSupersededError,
      dispatch,
      () => {
        paused = true;
      },
      () => dispatch({ type: 'lost', owner: null }),
      { currentState: 'active' },
    );
    const run = harness.run();
    expect(blocked.current).toBe(true);
    expect(paused).toBe(true);
    expect(stateRef.current.kind).toBe('checking');
    if (outcome === 'cancelled') harness.cancel();
    complete();
    await run;
    expect(stateRef.current.kind).toBe(
      outcome === 'owned' || outcome === 'offline'
        ? 'active'
        : outcome === 'superseded'
          ? 'paused'
          : 'checking',
    );
    // Only the render/effect that applies the verified state releases input.
    expect(blocked.current).toBe(true);
  });
}
