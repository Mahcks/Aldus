import type { ReadingClaim } from '@/generated/api';
import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { APIError, api } from '@/lib/api';
import { getDeviceIdentity } from '@/lib/device-identity';
import {
  bindReadingRepresentations,
  pauseReadingProof,
  OwnershipSupersededError,
  registerReadingProof,
  reportOwnershipLost,
  subscribeOwnershipLost,
} from '@/lib/consumption/reading-proof';
import { SLOW_TRANSFER_AFTER_SECONDS } from '@/lib/consumption/handoff-copy';
import {
  initialSessionState,
  pausedDeviceOf,
  readingSessionReducer,
  showsContent,
  mayWritePosition,
  takeoverViewFor,
} from '@/lib/consumption/reading-session';
import { randomID } from '@/lib/random-id';
import { cachedReadingProof, cacheReadingProof } from '@/lib/consumption/reading-proof-cache';

const HEARTBEAT_MS = 15_000;

/**
 * Runs this device's hold on one book: asks the server who is reading, claims
 * or asks before taking over, keeps the claim fresh, and notices when another
 * device takes it. Position and progress logic are not touched here; this only
 * decides whether this device may save, and tells the screen what to show.
 */
export function useReadingSession(workID: string) {
  const [state, dispatch] = useReducer(readingSessionReducer, initialSessionState);
  // Bumped after every takeover so the reading screen reloads the newly saved place.
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<ReadingClaim>();
  const requests = useRef(new Map<number, string>());
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const claimAttempt = state.kind === 'claiming' && state.step === 'server' ? state.attempt : 0;
  const claimOwnerEpoch = state.kind === 'claiming' ? (state.owner?.epoch ?? 0) : 0;
  const claimInteractive = state.kind === 'claiming' && state.interactive;
  const heldProof = 'proof' in state ? state.proof : undefined;
  const activeDeviceID = heldProof?.device_id;
  const activeEpoch = heldProof?.epoch;
  const pendingAttempt = state.kind === 'claiming' ? state.attempt : 0;

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const identity = await getDeviceIdentity();
        const owner = await api.readingSession(workID);
        if (!cancelled) dispatch({ type: 'owner-loaded', owner, deviceID: identity.deviceID });
      } catch (error) {
        if (Platform.OS !== 'web' && error instanceof APIError && error.status === 0) {
          const proof = await cachedReadingProof(workID);
          if (!cancelled && proof) {
            registerReadingProof(workID, proof, false);
            dispatch({ type: 'offline-loaded', proof });
            return;
          }
        }
        if (__DEV__)
          console.warn('Aldus reading ownership lookup failed', {
            workID,
            status: error instanceof APIError ? error.status : undefined,
          });
        if (!cancelled) dispatch({ type: 'unavailable' });
      }
    }

    void start();
    return () => {
      cancelled = true;
      pauseReadingProof(workID);
    };
  }, [workID]);

  useEffect(() => {
    if (!claimAttempt) return;
    let cancelled = false;

    async function claim() {
      try {
        const identity = await getDeviceIdentity();
        const claimed = await api.claimReadingSession(workID, {
          device_id: identity.deviceID,
          label: identity.label,
          platform: identity.platform,
          request_id:
            requests.current.get(claimOwnerEpoch) ??
            (() => {
              const id = randomID();
              requests.current.set(claimOwnerEpoch, id);
              return id;
            })(),
          expected_epoch: claimOwnerEpoch,
        });
        if (cancelled) return;
        const proof = { device_id: claimed.owner.device_id, epoch: claimed.owner.epoch };
        registerReadingProof(workID, proof, false);
        await cacheReadingProof(workID, proof).catch(() => {});
        if (cancelled) return;
        setSnapshot(claimed);
        dispatch({ type: 'claimed', proof });
        if (claimInteractive) setGeneration((current) => current + 1);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof OwnershipSupersededError) {
          dispatch({ type: 'claim-superseded', owner: error.owner });
          return;
        }
        const unreachable = error instanceof APIError && error.status === 0;
        dispatch({ type: 'claim-failed', reason: unreachable ? 'unreachable' : 'refused' });
      }
    }

    void claim();
    return () => {
      cancelled = true;
    };
  }, [workID, claimAttempt, claimOwnerEpoch, claimInteractive]);

  // Use the same check for heartbeats and progress refreshes. A superseded
  // reader must stop before adopting another device's position.
  const checkOwnership = useCallback(async () => {
    const current = stateRef.current;
    if (!('proof' in current) || !current.proof) return false;
    try {
      await api.refreshReadingSession(workID, current.proof);
      return stateRef.current === current;
    } catch (error) {
      if (stateRef.current === current && error instanceof OwnershipSupersededError) {
        reportOwnershipLost(workID, error.owner);
      }
      throw error;
    }
  }, [workID]);

  useEffect(() => {
    if (!activeDeviceID || !activeEpoch) return;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        await checkOwnership();
      } catch {
        // Offline readers retain their local position. Ownership rejection is
        // handled synchronously by checkOwnership, before any progress refresh.
      } finally {
        running = false;
      }
    }
    const timer = setInterval(() => void refresh(), HEARTBEAT_MS);
    const foreground = AppState.addEventListener('change', (value) => {
      if (value === 'active') void refresh();
    });
    return () => {
      foreground.remove();
      clearInterval(timer);
    };
  }, [activeDeviceID, activeEpoch, checkOwnership]);

  useEffect(
    () =>
      subscribeOwnershipLost((lostWorkID, owner) => {
        if (lostWorkID === workID) dispatch({ type: 'lost', owner });
      }),
    [workID],
  );

  useEffect(() => {
    if (!pendingAttempt) return;
    const timer = setTimeout(() => dispatch({ type: 'slow' }), SLOW_TRANSFER_AFTER_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [pendingAttempt]);

  const bindRepresentations = useCallback(
    (representationIDs: string[]) => bindReadingRepresentations(workID, representationIDs),
    [workID],
  );
  useEffect(() => {
    if (heldProof) registerReadingProof(workID, heldProof, mayWritePosition(state));
    else pauseReadingProof(workID);
  }, [workID, heldProof, state]);

  const contentReady = useCallback(() => dispatch({ type: 'content-ready' }), []);
  const contentFailed = useCallback(
    (reason: 'restore' | 'not-downloaded') => dispatch({ type: 'content-failed', reason }),
    [],
  );
  const backToBook = useCallback(() => router.replace(`/work/${workID}`), [workID]);

  return {
    state,
    generation,
    snapshot,
    showsContent: showsContent(state),
    mayWrite: mayWritePosition(state),
    takeoverView: takeoverViewFor(state),
    pausedDevice: pausedDeviceOf(state),
    continueHere: useCallback(() => dispatch({ type: 'continue' }), []),
    retry: () => {
      if (state.kind === 'failed' && state.proof) setGeneration((value) => value + 1);
      dispatch({ type: 'retry' });
    },
    cancel: useCallback(() => dispatch({ type: 'cancel' }), []),
    resume: useCallback(() => dispatch({ type: 'resume' }), []),
    /** "Not now" and "Back to book" both return to book details. */
    notNow: backToBook,
    backToBook,
    bindRepresentations,
    contentReady,
    contentFailed,
    checkOwnership,
  };
}

export type ReadingSession = ReturnType<typeof useReadingSession>;
