import type {
  ReadingOwnershipProof,
  RepresentationState,
  RepresentationStateUpdate,
} from '@/generated/api';
import { api } from '@/lib/api';
import { OwnershipSupersededError } from './reading-proof';

export function representationStateUpdate(
  state: RepresentationState,
  expectedRevision: number,
): RepresentationStateUpdate {
  const { representation_id: _, revision: __, updated_at: ___, ...values } = state;
  return { ...values, expected_revision: expectedRevision };
}

/** A retry may have lost the response to a write that already committed. */
export async function acknowledgedEditionSave(
  workID: string,
  local: RepresentationState,
  remote: RepresentationState | null,
  ownership?: ReadingOwnershipProof,
) {
  if (
    !ownership ||
    !remote ||
    remote.representation_id !== local.representation_id ||
    remote.revision !== local.revision + 1
  )
    return false;
  const { expected_revision: _, ...values } = representationStateUpdate(local, local.revision);
  if (
    !Object.entries(values).every(([key, value]) =>
      sameJSON(value, remote[key as keyof RepresentationState]),
    )
  )
    return false;
  // Never turn a previous owner's queued write into permission to write here.
  try {
    await api.refreshReadingSession(workID, ownership);
  } catch (error) {
    if (error instanceof OwnershipSupersededError) return false;
    throw error;
  }
  return true;
}

function sameJSON(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = Object.entries(left).filter(([, value]) => value !== undefined);
  const b = Object.entries(right).filter(([, value]) => value !== undefined);
  return (
    Array.isArray(left) === Array.isArray(right) &&
    a.length === b.length &&
    a.every(
      ([key, value]) =>
        Object.hasOwn(right, key) && sameJSON(value, (right as Record<string, unknown>)[key]),
    )
  );
}

// Foreground saves and reconnect replay must not submit the same revision together.
const editionWrites = new Map<string, Promise<unknown>>();
export function serializeEditionSave<T>(key: string, save: () => Promise<T>): Promise<T> {
  const previous = editionWrites.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(save);
  editionWrites.set(key, current);
  void current
    .finally(() => {
      if (editionWrites.get(key) === current) editionWrites.delete(key);
    })
    .catch(() => {});
  return current;
}
