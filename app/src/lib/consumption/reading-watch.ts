import type { ReadingOwner, ReadingOwnershipProof } from '@/generated/api';
import { api, APIError } from '@/lib/api';
import { activeStorageScope } from '@/lib/storage-scope';
import { getAPIBaseURL } from '@/lib/api-base';
import { reportOwnershipLost } from './reading-proof';

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

// Reports changed ownership; the default invalidates only the captured proof.
// Paused readers supply an observer to keep their resume prompt current.
// Claims, restoration, and offline saves
// remain owned by the session hook and their existing transaction paths.
export async function watchReadingOwnership(
  workID: string,
  proof: ReadingOwnershipProof,
  signal: AbortSignal,
  onChange: (owner: ReadingOwner | null) => void = (owner) =>
    reportOwnershipLost(workID, owner, proof),
) {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const current = () =>
    !signal.aborted && origin === getAPIBaseURL() && scope === activeStorageScope();
  let failures = 0;
  while (current()) {
    try {
      const owner = await api.watchReadingSession(workID, proof.epoch, signal);
      if (!current()) return;
      if (owner?.epoch !== proof.epoch || owner?.device_id !== proof.device_id) {
        onChange(owner);
        return;
      }
      failures = 0;
    } catch (error) {
      if (!current()) return;
      // Unsupported servers keep the heartbeat; authorization/account changes
      // must never retry an old watch into another session.
      if (error instanceof APIError && [401, 403, 404, 409].includes(error.status)) return;
      const backoff = Math.min(15_000, 1000 * 2 ** Math.min(failures++, 4));
      const delay = Math.max(
        backoff * (0.75 + Math.random() * 0.25),
        error instanceof APIError ? (error.retryAfterMS ?? 0) : 0,
      );
      await waitForRetry(delay, signal);
    }
  }
}
