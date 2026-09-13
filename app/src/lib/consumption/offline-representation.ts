import type { RepresentationState, RepresentationStateUpdate } from '@/generated/api';

export function representationStateUpdate(
  state: RepresentationState,
  expectedRevision: number,
): RepresentationStateUpdate {
  const { representation_id: _, revision: __, updated_at: ___, ...values } = state;
  return { ...values, expected_revision: expectedRevision };
}
