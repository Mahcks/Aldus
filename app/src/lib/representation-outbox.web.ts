import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReadingOwnershipProof, RepresentationState } from '@/generated/api';
import { APIError, api } from './api';
import { getAPIBaseURL } from './api-base';
import { getDeviceIdentity } from './device-identity';
import { activeStorageScope, scopedStorageKey } from './storage-scope';
import { serializeProgressMutation } from './progress-outbox-storage';
import {
  representationStateUpdate,
  serializeEditionSave,
} from './consumption/offline-representation';
import { OwnershipSupersededError, readingProofForWork } from './consumption/reading-proof';
import type { RepresentationConflict } from './offline-library.native';

const acknowledgedStates = new Map<string, RepresentationState>();

export async function offlineRepresentationState(
  workID: string,
  kind: 'epub' | 'audio',
  scope = activeStorageScope(),
) {
  return acknowledgedStates.get(await storageKey(scope, workID, kind)) ?? null;
}

type PendingEdition = {
  workID: string;
  kind: 'epub' | 'audio';
  local: RepresentationState;
  ownership?: ReadingOwnershipProof;
};

async function prefix(scope: string) {
  const device = await getDeviceIdentity();
  return scopedStorageKey(`edition-outbox:${device.deviceID}:`, scope);
}

async function storageKey(scope: string, workID: string, kind: string) {
  return (await prefix(scope)) + workID + ':' + kind;
}

export function updateOfflineRepresentationState(
  workID: string,
  kind: 'epub' | 'audio',
  state: RepresentationState,
  pending = false,
  scope = activeStorageScope(),
  ownership = pending ? readingProofForWork(workID) : undefined,
) {
  if (!pending) return Promise.resolve(false);
  return serializeProgressMutation(async () => {
    const record: PendingEdition = { workID, kind, local: state, ownership };
    await AsyncStorage.setItem(await storageKey(scope, workID, kind), JSON.stringify(record));
    return true;
  });
}

export function acknowledgeOfflineRepresentationState(
  workID: string,
  kind: 'epub' | 'audio',
  submitted: RepresentationState,
  saved: RepresentationState | null,
  rebaseNewer = true,
  scope = activeStorageScope(),
) {
  return serializeProgressMutation(async () => {
    const key = await storageKey(scope, workID, kind);
    if (saved) acknowledgedStates.set(key, saved);
    else acknowledgedStates.delete(key);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return;
    const pending: PendingEdition = JSON.parse(raw);
    if (pending.local.representation_id !== submitted.representation_id) return;
    if (JSON.stringify(pending.local) === JSON.stringify(submitted)) {
      await AsyncStorage.removeItem(key);
    } else if (saved && rebaseNewer && pending.local.revision === submitted.revision) {
      pending.local.revision = saved.revision;
      await AsyncStorage.setItem(key, JSON.stringify(pending));
    }
  });
}

const reconciliations = new Map<string, Promise<RepresentationConflict | null>>();

export async function reconcileOfflineRepresentationStates(
  workID?: string,
): Promise<RepresentationConflict[]> {
  const scope = activeStorageScope();
  if (!scope) return [];
  const origin = getAPIBaseURL();
  const start = await prefix(scope);
  const keys = await serializeProgressMutation(() => AsyncStorage.getAllKeys());
  const conflicts: RepresentationConflict[] = [];
  for (const key of keys) {
    if (!key.startsWith(start)) continue;
    if (scope !== activeStorageScope() || origin !== getAPIBaseURL()) break;
    let pending = reconciliations.get(key);
    if (!pending) {
      pending = reconcileRecord(key, scope, origin, workID).finally(() =>
        reconciliations.delete(key),
      );
      reconciliations.set(key, pending);
    }
    const conflict = await pending;
    if (conflict && (!workID || conflict.workID === workID)) conflicts.push(conflict);
  }
  return conflicts;
}

async function reconcileRecord(
  key: string,
  scope: string,
  origin: string,
  workID?: string,
): Promise<RepresentationConflict | null> {
  const stillActive = () => scope === activeStorageScope() && origin === getAPIBaseURL();
  const raw = await serializeProgressMutation(() => AsyncStorage.getItem(key));
  if (!raw || !stillActive()) return null;
  const record: PendingEdition = JSON.parse(raw);
  if (workID && record.workID !== workID) return null;
  return serializeEditionSave(record.workID, async () => {
    const latestRaw = await serializeProgressMutation(() => AsyncStorage.getItem(key));
    if (!latestRaw || !stillActive()) return null;
    const record: PendingEdition = JSON.parse(latestRaw);
    try {
      const saved = await api.updateRepresentationState(record.local.representation_id, {
        ...representationStateUpdate(record.local, record.local.revision),
        ownership: record.ownership,
      });
      if (!stillActive()) return null;
      await acknowledgeOfflineRepresentationState(
        record.workID,
        record.kind,
        record.local,
        saved,
        true,
        scope,
      );
    } catch (error) {
      if (!stillActive()) return null;
      if (
        (error instanceof APIError && error.status === 409) ||
        error instanceof OwnershipSupersededError
      ) {
        const remote = await api
          .representationState(record.local.representation_id)
          .catch(() => undefined);
        const currentRaw = await serializeProgressMutation(() => AsyncStorage.getItem(key));
        if (remote !== undefined && currentRaw && stillActive()) {
          const current: PendingEdition = JSON.parse(currentRaw);
          if (
            current.local.representation_id === record.local.representation_id &&
            current.local.revision === record.local.revision
          ) {
            return { workID: current.workID, kind: current.kind, local: current.local, remote };
          }
        }
      }
      // Failed requests keep their original proof and remain queued for an explicit choice.
    }
    return null;
  });
}
