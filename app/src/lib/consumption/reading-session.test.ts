import { describe, expect, it } from 'bun:test';
import type { ReadingOwner } from '@/generated/api';
import {
  deviceOf,
  initialSessionState,
  mayWritePosition,
  pausedDeviceOf,
  readingSessionReducer,
  showsContent,
  takeoverViewFor,
  type SessionEvent,
  type SessionState,
} from './reading-session';

function owner(overrides: Partial<ReadingOwner> = {}): ReadingOwner {
  return {
    work_id: 'work',
    device_id: 'phone',
    label: 'your iPhone',
    platform: 'ios',
    epoch: 3,
    updated_at: '2026-09-25T20:00:00Z',
    idle_seconds: 120,
    ...overrides,
  };
}

function run(events: SessionEvent[], from: SessionState = initialSessionState) {
  return events.reduce(readingSessionReducer, from);
}

const loaded = (value: ReadingOwner | null, deviceID = 'laptop'): SessionEvent => ({
  type: 'owner-loaded',
  owner: value,
  deviceID,
});

describe('opening a book', () => {
  it('claims silently when nobody has the book', () => {
    const state = run([loaded(null)]);

    expect(state.kind).toBe('claiming');
    expect(state.kind === 'claiming' && state.interactive).toBe(false);
    expect(showsContent(state)).toBe(false);
  });

  it('waits for restoration after a silent claim succeeds', () => {
    const state = run([
      loaded(null),
      { type: 'claimed', proof: { device_id: 'laptop', epoch: 1 } },
    ]);

    expect(state).toMatchObject({
      kind: 'claiming',
      step: 'restore',
      proof: { device_id: 'laptop', epoch: 1 },
    });
    expect(mayWritePosition(state)).toBe(false);
  });

  it('claims a fresh epoch instead of adopting another surface’s credential', () => {
    const state = run([loaded(owner({ device_id: 'laptop', epoch: 5 }))]);

    expect(state).toMatchObject({ kind: 'claiming', step: 'server' });
  });

  it('asks before taking over a recently active device', () => {
    const state = run([loaded(owner({ idle_seconds: 30 }))]);

    expect(state.kind).toBe('prompt');
    expect(showsContent(state)).toBe(false);
    expect(mayWritePosition(state)).toBe(false);
  });

  it('takes over silently from a device idle for more than a day', () => {
    const state = run([loaded(owner({ idle_seconds: 25 * 60 * 60 }))]);

    expect(state.kind === 'claiming' && state.interactive).toBe(false);
  });

  it('does not allow unfenced saves when ownership cannot be checked', () => {
    const state = run([{ type: 'unavailable' }]);

    expect(state.kind).toBe('failed');
    expect(mayWritePosition(state)).toBe(false);
  });
});

describe('continuing here', () => {
  const prompt = () => run([loaded(owner())]);

  it('shows the dialog through both steps and only then becomes active', () => {
    let state = run([{ type: 'continue' }], prompt());
    expect(state.kind === 'claiming' && state.step).toBe('server');
    expect(showsContent(state)).toBe(false);

    state = run([{ type: 'claimed', proof: { device_id: 'laptop', epoch: 4 } }], state);
    expect(state.kind === 'claiming' && state.step).toBe('restore');
    expect(showsContent(state)).toBe(true);
    expect(mayWritePosition(state)).toBe(false);

    state = run([{ type: 'content-ready' }], state);
    expect(state).toEqual({ kind: 'active', attempt: 1, proof: { device_id: 'laptop', epoch: 4 } });
  });

  it('never becomes active on a server answer alone', () => {
    const state = run(
      [{ type: 'continue' }, { type: 'claimed', proof: { device_id: 'laptop', epoch: 4 } }],
      prompt(),
    );

    expect(mayWritePosition(state)).toBe(false);
  });

  it('returns to the prompt for whoever won the race', () => {
    const winner = owner({ device_id: 'tablet', label: 'your iPad', epoch: 4 });
    const state = run(
      [{ type: 'continue' }, { type: 'claim-superseded', owner: winner }],
      prompt(),
    );

    expect(state).toEqual({ kind: 'prompt', owner: winner });
  });

  it('reports a refused transfer and retries the whole takeover', () => {
    let state = run(
      [{ type: 'continue' }, { type: 'claim-failed', reason: 'unreachable' }],
      prompt(),
    );
    expect(state.kind === 'failed' && state.reason).toBe('unreachable');

    state = run([{ type: 'retry' }], state);
    expect(state.kind === 'claiming' && state.step).toBe('server');
    expect(state.kind === 'claiming' && state.interactive).toBe(true);
  });

  it('retries only the restore when the place would not open', () => {
    let state = run(
      [
        { type: 'continue' },
        { type: 'claimed', proof: { device_id: 'laptop', epoch: 4 } },
        { type: 'content-failed', reason: 'restore' },
      ],
      prompt(),
    );
    expect(state.kind === 'failed' && state.reason).toBe('restore');
    expect(mayWritePosition(state)).toBe(false);

    state = run([{ type: 'retry' }], state);
    expect(state.kind === 'claiming' && state.step).toBe('restore');
    expect(state.kind === 'claiming' && state.proof).toEqual({ device_id: 'laptop', epoch: 4 });
  });

  it('offers cancel only once the transfer is slow, and returns to the prompt', () => {
    let state = run([{ type: 'continue' }], prompt());
    expect(run([{ type: 'cancel' }], state)).toEqual(state);

    state = run([{ type: 'slow' }, { type: 'cancel' }], state);
    expect(state.kind).toBe('prompt');
  });
});

describe('losing the book to another device', () => {
  const active = () =>
    run([
      loaded(null),
      { type: 'claimed', proof: { device_id: 'laptop', epoch: 1 } },
      { type: 'content-ready' },
    ]);

  it('pauses, stops writing, and keeps the screen open', () => {
    const winner = owner();
    const state = run([{ type: 'lost', owner: winner }], active());

    expect(state).toMatchObject({ kind: 'paused', owner: winner });
    expect(mayWritePosition(state)).toBe(false);
    expect(showsContent(state)).toBe(true);
  });

  it('ignores a loss report when this device never had the book', () => {
    const state = run([{ type: 'lost', owner: owner() }], run([loaded(owner())]));

    expect(state.kind).toBe('prompt');
  });

  it('reclaims control only through an explicit resume', () => {
    const paused = run([{ type: 'lost', owner: owner() }], active());
    expect(run([{ type: 'content-ready' }], paused)).toEqual(paused);
    expect(run([{ type: 'continue' }], paused)).toEqual(paused);

    const resuming = run([{ type: 'resume' }], paused);
    expect(resuming.kind === 'claiming' && resuming.origin).toBe('resume');
    expect(resuming.kind === 'claiming' && resuming.interactive).toBe(true);
    expect(showsContent(resuming)).toBe(true);
  });

  it('returns to paused when a slow resume is cancelled', () => {
    const paused = run([{ type: 'lost', owner: owner() }], active());
    const state = run([{ type: 'resume' }, { type: 'slow' }, { type: 'cancel' }], paused);

    expect(state.kind).toBe('paused');
  });
});

describe('silent claims', () => {
  it('block saves when a silent claim fails', () => {
    const state = run([loaded(null), { type: 'claim-failed', reason: 'unreachable' }]);

    expect(state.kind).toBe('failed');
    expect(mayWritePosition(state)).toBe(false);
  });
});

describe('what the screen shows', () => {
  it('maps prompt, pending and failure states to dialog views and hides it otherwise', () => {
    const prompt = run([loaded(owner({ idle_seconds: 90 }))]);
    expect(takeoverViewFor(prompt)).toEqual({
      kind: 'prompt',
      device: { label: 'your iPhone', platform: 'ios' },
      secondsSinceActive: 90,
    });

    const pending = run([{ type: 'continue' }], prompt);
    expect(takeoverViewFor(pending)?.kind).toBe('pending');

    const failed = run([{ type: 'claim-failed', reason: 'refused' }], pending);
    expect(takeoverViewFor(failed)).toMatchObject({ kind: 'failed', reason: 'refused' });

    const silent = run([loaded(null)]);
    expect(takeoverViewFor(silent)).toBeUndefined();
    expect(
      takeoverViewFor(
        run([loaded(null), { type: 'claimed', proof: { device_id: 'a', epoch: 1 } }]),
      ),
    ).toBeUndefined();
  });

  it('names the device that took over while this one is paused or resuming', () => {
    const active = run([
      loaded(null),
      { type: 'claimed', proof: { device_id: 'laptop', epoch: 1 } },
    ]);
    const paused = run([{ type: 'lost', owner: owner() }], active);

    expect(pausedDeviceOf(active)).toBeUndefined();
    expect(pausedDeviceOf(paused)).toEqual(deviceOf(owner()));
    expect(pausedDeviceOf(run([{ type: 'resume' }], paused))).toEqual(deviceOf(owner()));
  });
});

it('ownership loss during restoration cannot be undone by a late ready event', () => {
  const restoring = run([
    loaded(null),
    { type: 'claimed', proof: { device_id: 'laptop', epoch: 1 } },
  ]);
  const paused = run([{ type: 'lost', owner: owner() }, { type: 'content-ready' }], restoring);
  expect(paused.kind).toBe('paused');
  expect(mayWritePosition(paused)).toBe(false);
});

it('offline reopening restores with its last confirmed epoch and never claims a new one', () => {
  const proof = { device_id: 'phone', epoch: 4 };
  const restoring = run([{ type: 'offline-loaded', proof }]);
  expect(restoring).toMatchObject({ kind: 'claiming', step: 'restore', proof });
  expect(mayWritePosition(restoring)).toBe(false);
  const active = run([{ type: 'content-ready' }], restoring);
  expect(active).toMatchObject({ kind: 'active', proof });
  expect(run([{ type: 'lost', owner: owner({ epoch: 5 }) }], active).kind).toBe('paused');
});
