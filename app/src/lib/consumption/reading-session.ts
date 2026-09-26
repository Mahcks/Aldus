import type { ReadingOwner, ReadingOwnershipProof } from '@/generated/api';
import type { HandoffDevice, TakeoverView } from './handoff-copy';

/**
 * The lifecycle of this device's hold on one book, as a pure state machine.
 * The hook around it performs the requests and timers; this file only decides
 * what each outcome means, so every transition can be tested without a screen.
 */

/** A device silent for longer than this is taken over without asking. */
export const PROMPT_WINDOW_SECONDS = 24 * 60 * 60;

export type SessionOrigin = 'open' | 'resume';

export type FailureReason = 'unreachable' | 'refused' | 'restore' | 'not-downloaded';

export type SessionState =
  | { kind: 'starting' }
  | { kind: 'prompt'; owner: ReadingOwner }
  /** `interactive` claims show the dialog; silent claims (nobody else active) do not. */
  | {
      kind: 'claiming';
      attempt: number;
      owner: ReadingOwner | null;
      origin: SessionOrigin;
      interactive: boolean;
      step: 'server' | 'restore';
      slow: boolean;
      proof?: ReadingOwnershipProof;
    }
  | {
      kind: 'failed';
      attempt: number;
      owner: ReadingOwner | null;
      origin: SessionOrigin;
      reason: FailureReason;
      proof?: ReadingOwnershipProof;
    }
  | { kind: 'active'; proof: ReadingOwnershipProof; attempt: number }
  | { kind: 'paused'; owner: ReadingOwner | null; attempt: number };

export type SessionEvent =
  | { type: 'owner-loaded'; owner: ReadingOwner | null; deviceID: string }
  | { type: 'unavailable' }
  | { type: 'offline-loaded'; proof: ReadingOwnershipProof }
  | { type: 'continue' }
  | { type: 'claimed'; proof: ReadingOwnershipProof }
  | { type: 'claim-superseded'; owner: ReadingOwner | null }
  | { type: 'claim-failed'; reason: 'unreachable' | 'refused' }
  | { type: 'content-ready' }
  | { type: 'content-failed'; reason: 'restore' | 'not-downloaded' }
  | { type: 'slow' }
  | { type: 'retry' }
  | { type: 'cancel' }
  | { type: 'lost'; owner: ReadingOwner | null }
  | { type: 'resume' };

export const initialSessionState: SessionState = { kind: 'starting' };

function attemptOf(state: SessionState) {
  return 'attempt' in state ? state.attempt : 0;
}

function claiming(
  state: SessionState,
  owner: ReadingOwner | null,
  origin: SessionOrigin,
  interactive: boolean,
): SessionState {
  return {
    kind: 'claiming',
    attempt: attemptOf(state) + 1,
    owner,
    origin,
    interactive,
    step: 'server',
    slow: false,
  };
}

export function readingSessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'owner-loaded': {
      if (state.kind !== 'starting') return state;
      const { owner, deviceID } = event;
      if (!owner) return claiming(state, null, 'open', false);
      if (owner.device_id === deviceID) {
        return claiming(state, owner, 'open', false);
      }
      if (owner.idle_seconds > PROMPT_WINDOW_SECONDS) return claiming(state, owner, 'open', false);
      return { kind: 'prompt', owner };
    }
    case 'offline-loaded':
      return state.kind === 'starting'
        ? {
            kind: 'claiming',
            attempt: 1,
            owner: null,
            origin: 'open',
            interactive: false,
            step: 'restore',
            slow: false,
            proof: event.proof,
          }
        : state;
    case 'unavailable':
      return state.kind === 'starting'
        ? { kind: 'failed', attempt: 0, owner: null, origin: 'open', reason: 'unreachable' }
        : state;
    case 'continue':
      return state.kind === 'prompt' ? claiming(state, state.owner, 'open', true) : state;
    case 'claimed': {
      if (state.kind !== 'claiming') return state;
      return { ...state, step: 'restore', slow: false, proof: event.proof };
    }
    case 'claim-superseded': {
      if (state.kind !== 'claiming') return state;
      if (!event.owner) return claiming(state, null, state.origin, state.interactive);
      return { kind: 'prompt', owner: event.owner };
    }
    case 'claim-failed': {
      if (state.kind !== 'claiming' || state.step !== 'server') return state;
      return {
        kind: 'failed',
        attempt: state.attempt,
        owner: state.owner,
        origin: state.origin,
        reason: event.reason,
      };
    }
    case 'content-ready':
      return state.kind === 'claiming' && state.step === 'restore' && state.proof
        ? { kind: 'active', attempt: state.attempt, proof: state.proof }
        : state;
    case 'content-failed':
      return state.kind === 'claiming' && state.step === 'restore'
        ? {
            kind: 'failed',
            attempt: state.attempt,
            owner: state.owner,
            origin: state.origin,
            reason: event.reason,
            proof: state.proof,
          }
        : state;
    case 'slow':
      return state.kind === 'claiming' ? { ...state, slow: true } : state;
    case 'retry': {
      if (state.kind !== 'failed') return state;
      // A place that would not open is retried without asking the server to switch again.
      if ((state.reason === 'restore' || state.reason === 'not-downloaded') && state.proof) {
        return {
          kind: 'claiming',
          attempt: state.attempt + 1,
          owner: state.owner,
          origin: state.origin,
          interactive: true,
          step: 'restore',
          slow: false,
          proof: state.proof,
        };
      }
      return claiming(state, state.owner, state.origin, true);
    }
    case 'cancel': {
      if (state.kind !== 'claiming' || !state.slow) return state;
      return state.origin === 'resume' || !state.owner
        ? { kind: 'paused', owner: state.owner, attempt: state.attempt + 1 }
        : { kind: 'prompt', owner: state.owner };
    }
    case 'lost':
      return state.kind === 'active' ||
        (state.kind === 'claiming' && state.step === 'restore') ||
        (state.kind === 'failed' && state.proof)
        ? { kind: 'paused', owner: event.owner, attempt: state.attempt + 1 }
        : state;
    case 'resume':
      return state.kind === 'paused' ? claiming(state, state.owner, 'resume', true) : state;
  }
}

/** Whether the reading or listening screen itself should be on screen. */
export function showsContent(state: SessionState) {
  switch (state.kind) {
    case 'starting':
    case 'prompt':
      return false;
    case 'claiming':
      return state.origin === 'resume' || state.step === 'restore';
    case 'failed':
      return state.origin === 'resume' || Boolean(state.proof);
    default:
      return true;
  }
}

/** Whether a position save from this device may be sent. */
export function mayWritePosition(state: SessionState) {
  return state.kind === 'active';
}

export function deviceOf(owner: ReadingOwner | null): HandoffDevice {
  return owner ? { label: owner.label, platform: owner.platform } : { platform: 'other' };
}

/** What the takeover dialog should show, or nothing when the dialog is closed. */
export function takeoverViewFor(state: SessionState): TakeoverView | undefined {
  switch (state.kind) {
    case 'prompt':
      return {
        kind: 'prompt',
        device: deviceOf(state.owner),
        secondsSinceActive: state.owner.idle_seconds,
      };
    case 'claiming':
      return state.interactive
        ? {
            kind: 'pending',
            device: deviceOf(state.owner),
            step: state.step,
            slow: state.slow,
          }
        : undefined;
    case 'failed':
      return {
        kind: 'failed',
        device: deviceOf(state.owner),
        reason: state.reason,
      };
    default:
      return undefined;
  }
}

/** The device that took the book over, while this one is paused or resuming; otherwise nothing. */
export function pausedDeviceOf(state: SessionState): HandoffDevice | undefined {
  if (state.kind === 'paused') return deviceOf(state.owner);
  const resuming =
    (state.kind === 'claiming' || state.kind === 'failed') && state.origin === 'resume';
  return resuming ? deviceOf(state.owner) : undefined;
}
