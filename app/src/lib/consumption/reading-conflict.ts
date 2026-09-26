import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CanonicalPosition } from '@/generated/api';
import type { RepresentationConflict } from '@/lib/offline-library';
import { getDeviceIdentity } from '@/lib/device-identity';
import { activeStorageScope, scopedStorageKey } from '@/lib/storage-scope';

export type ProgressConflict = { local: CanonicalPosition; remote: CanonicalPosition | null };
type SavedConflicts = { progress?: ProgressConflict; edition?: RepresentationConflict };
let writes = Promise.resolve();

async function key(workID: string, scope: string) {
  if (!scope) throw new Error('No active account for saving both places.');
  const device = await getDeviceIdentity();
  return scopedStorageKey(`reading-conflict:${device.deviceID}:${workID}`, scope);
}

export async function savedReadingConflicts(
  workID: string,
  scope = activeStorageScope(),
): Promise<SavedConflicts> {
  await writes;
  const raw = await AsyncStorage.getItem(await key(workID, scope));
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Could not read the saved places on this device.');
  return value;
}

// Keep unresolved places until an explicit choice succeeds. Scope includes the
// account/server and device, so another tab's claim cannot erase this choice.
export function rememberReadingConflict<K extends keyof SavedConflicts>(
  workID: string,
  kind: K,
  value: SavedConflicts[K],
  scope = activeStorageScope(),
) {
  const result = writes.then(async () => {
    const storageKey = await key(workID, scope);
    const raw = await AsyncStorage.getItem(storageKey);
    const saved: SavedConflicts = raw ? JSON.parse(raw) : {};
    if (value) saved[kind] = value;
    else delete saved[kind];
    if (saved.progress || saved.edition)
      await AsyncStorage.setItem(storageKey, JSON.stringify(saved));
    else await AsyncStorage.removeItem(storageKey);
  });
  writes = result.catch(() => {});
  return result;
}
