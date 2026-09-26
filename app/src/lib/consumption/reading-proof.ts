import type { ReadingOwner, ReadingOwnershipProof } from '@/generated/api';
import { activeStorageScope } from '@/lib/storage-scope';
import { getAPIBaseURL } from '@/lib/api-base';

/**
 * The ownership proof this device holds for the book it has open. The API
 * client stamps it on position saves, so callers that build progress updates
 * never handle it. Only one book is open for reading at a time.
 */
type Registration = {
  workID: string;
  proof: ReadingOwnershipProof;
  representationIDs: Set<string>;
  writable: boolean;
};

const registrations = new Map<string, Registration>();
const key = (workID: string) => JSON.stringify([getAPIBaseURL(), activeStorageScope(), workID]);
function registrationFor(workID: string) {
  return registrations.get(key(workID));
}
const lostListeners = new Set<(workID: string, owner: ReadingOwner | null) => void>();

export function registerReadingProof(
  workID: string,
  proof: ReadingOwnershipProof,
  writable = true,
) {
  const representationIDs = registrationFor(workID)?.representationIDs ?? new Set<string>();
  registrations.set(key(workID), { workID, proof, representationIDs, writable });
}

export function bindReadingRepresentations(workID: string, representationIDs: string[]) {
  const registration = registrationFor(workID);
  if (!registration) return;
  // Retain previous editions too: a late callback from the old selection
  // must remain fenced after the user chooses another representation.
  for (const id of representationIDs) {
    if (id) registration.representationIDs.add(id);
  }
}

export function clearReadingProof(workID: string) {
  registrations.delete(key(workID));
}

// Used by queued callbacks as well as controls; React state can lag an API
// rejection, so consult the shared registration before producing another save.
export function maySaveReadingPosition(workID: string) {
  return registrationFor(workID)?.writable !== false;
}

export function readingProofForWork(workID: string) {
  const registration = registrationFor(workID);
  if (!registration) return undefined;
  if (!registration.writable)
    throw new Error('Your reading session is paused until your saved place is restored.');
  return registration.proof;
}

/** Only representations of the open book are fenced; other books' saves must never carry its proof. */
export function readingProofForRepresentation(representationID: string) {
  for (const registration of registrations.values()) {
    if (registrationFor(registration.workID) !== registration) continue;
    if (registration.representationIDs.has(representationID)) {
      return { workID: registration.workID, proof: readingProofForWork(registration.workID)! };
    }
  }
  return undefined;
}

// Keep a blocked registration after unmount: late callbacks must not downgrade
// into legacy, unfenced writes simply because their screen has closed.
export function pauseReadingProof(workID: string) {
  const registration = registrationFor(workID);
  if (registration) registration.writable = false;
}

export function subscribeOwnershipLost(
  listener: (workID: string, owner: ReadingOwner | null) => void,
) {
  lostListeners.add(listener);
  return () => {
    lostListeners.delete(listener);
  };
}

export function reportOwnershipLost(
  workID: string,
  owner: ReadingOwner | null,
  attempted?: ReadingOwnershipProof,
) {
  const current = registrationFor(workID)?.proof;
  if (
    attempted &&
    (!current || current.device_id !== attempted.device_id || current.epoch !== attempted.epoch)
  )
    return;
  pauseReadingProof(workID);
  for (const listener of lostListeners) listener(workID, owner);
}

/** Another device took the book over: this save was refused and nothing was written. */
export class OwnershipSupersededError extends Error {
  constructor(public owner: ReadingOwner | null) {
    super('This book continued on another device.');
    this.name = 'OwnershipSupersededError';
  }
}

export function ownershipConflictFrom(body: string): { owner: ReadingOwner | null } | undefined {
  if (!body.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(body) as { code?: string; owner?: ReadingOwner | null };
    if (parsed.code !== 'ownership_superseded') return undefined;
    return { owner: parsed.owner ?? null };
  } catch {
    return undefined;
  }
}
