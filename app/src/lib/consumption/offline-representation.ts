import type { RepresentationState, RepresentationStateUpdate } from '@/generated/api';

export function representationStateUpdate(
  state: RepresentationState,
  expectedRevision: number,
): RepresentationStateUpdate {
  const { representation_id: _, revision: __, updated_at: ___, ...values } = state;
  return { ...values, expected_revision: expectedRevision };
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
